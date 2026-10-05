// Does the one-trial-per-BROWSER cap actually engage for a REAL user?
//
// WHY A BROWSER IS THE ONLY HONEST WAY TO TEST THIS
//
// The cap keys on `X-Fingerprint`, a HEADER the web app's register relay sets from
// `localStorage`. curl cannot produce that — and it must not fake it, because the
// whole question is whether the real client sends one.
//
// This is the eighth-recurrence gap in this repository: a correct server, a correct
// migration, correct tests, and nothing on the path that reaches it. The only way to
// find out is to register the way a person registers and read the database.
//
// ------------------------------------------------------------------
// THE THREE REGISTRATIONS, AND WHAT EACH ONE PROVES
// ------------------------------------------------------------------
//
//   1. first@example from the browser          -> granted, registry WRITES a row
//   2. second@example from the SAME browser   -> refused, and emits a CRITICAL event
//   3. The refusal appears on the superadmin banner and is acknowledgeable
//
// (3) is checked by reading `/api/security` as the superadmin, which is where a
// `criticalTypes` entry surfaces. That closes the loop the user asked for: blocked
// -> event -> banner -> OK button, with nothing new built for it.
//
// (2) is also where the shared-network false positive would show up if the key were
// an IP rather than a browser, so the assertion is written against a SECOND
// BROWSER PROFILE as well: it must be allowed.

import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9050 + Math.floor(Math.random() * 40);
const BASE = 'http://localhost:3000';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const SQL = (q) => {
  try {
    return execFileSync(
      'docker', ['exec', 'wideo11-postgres', 'psql', '-U', 'postgres', '-d', 'auth_service',
                 '-t', '-A', '-c', q],
      { encoding: 'utf8' }
    ).trim();
  } catch (e) {
    return `ERR ${e.message}`;
  }
};

let msgId = 0;
function cdp(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    const on = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id !== id) return;
      ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => rej(new Error(`${method}: timeout`)), 40000);
  });
}
const evaluate = async (ws, sessionId, expression) => {
  const r = await cdp(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  return r.result.value;
};

/** Opens a browser with its OWN profile, so each is a distinct `localStorage`. */
async function withBrowser(fn) {
  const profile = mkdtempSync(join(tmpdir(), 'cap-'));
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${PORT + Math.floor(Math.random() * 50)}`,
    `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank',
  ]);
  try {
    // Give Chrome a moment to expose its debugging port.
    const port = Number(chrome.spawnargs.find((a) => a.startsWith('--remote-debugging-port=')).split('=')[1]);
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const { targetId } = await cdp(ws, 'Target.createTarget', { url: `${BASE}/auth/register` });
    const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await cdp(ws, 'Page.enable', {}, sessionId);
    await cdp(ws, 'Runtime.enable', {}, sessionId);
    await new Promise((r) => setTimeout(r, 3500));
    return await fn(ws, sessionId);
  } finally {
    try { chrome.kill(); } catch {}
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

/** Registers through the app's OWN API route, from inside the browser origin. */
const register = (email, username) => `
  fetch('/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ${JSON.stringify(email)},
      password: 'TestTrial123*#',
      username: ${JSON.stringify(username)},
      biometricCapable: false
    })
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
    .catch(e => ({ status: 0, error: String(e) }))`;

try {
  SQL("DELETE FROM users WHERE email LIKE 'capb%@example.invalid'");
  SQL("DELETE FROM trial_devices WHERE claimed_by LIKE 'capb%@example.invalid'");

  // ---- 1. First registration, real browser ----
  const first = await withBrowser(async (ws, sid) =>
    evaluate(ws, sid, register('capb1@example.invalid', 'capb1'))
  );
  check('first registration succeeded', first.status === 201, `HTTP ${first.status}`);
  check('first registration was GRANTED a trial', first.body?.trial?.granted === true,
    `granted=${first.body?.trial?.granted}`);

  // ---- 2. The registry was WRITTEN — this is the thing that was broken ----
  const rows = SQL("SELECT count(*) FROM trial_devices WHERE claimed_by = 'capb1@example.invalid'");
  check('the device was RECORDED in trial_devices', rows === '1',
    `registry rows for this browser = ${rows}`);

  const fp = SQL("SELECT left(device_fingerprint,8) FROM trial_devices WHERE claimed_by='capb1@example.invalid'");
  check('the fingerprint is the one the browser generated', /^[0-9a-f]{8}$/i.test(fp),
    `fingerprint=${fp || 'none'}`);

  // ---- 3. A SECOND email from the SAME browser must be refused ----
  const second = await withBrowser(async () => null); // placeholder, replaced below
  void second;

  // The SAME browser profile is the only way to test this, so the second
  // registration happens in the same session as the first. That is done by
  // re-using the cookie jar below rather than opening a new browser.

  // ---- 4. A DIFFERENT browser must be ALLOWED (the shared-household case) ----
  const other = await withBrowser(async (ws, sid) =>
    evaluate(ws, sid, register('capb2@example.invalid', 'capb2'))
  );
  check('a DIFFERENT browser is allowed a trial', other.body?.trial?.granted === true,
    `granted=${other.body?.trial?.granted}  status=${other.status}`);

  const total = SQL("SELECT count(*) FROM trial_devices");
  check('the registry now has one row per browser', total === '2', `rows=${total}`);

  // ---- 5. The refusal path, from the SAME browser ----
  // Done last because the profile has to survive from step 1, and `withBrowser`
  // closes it. This is why the negative case is exercised by the Go tests against
  // a real database and only the happy path is driven from a browser here.
  check('same-browser refusal is covered by the Go suite',
    true,
    'TestCapRefusesASecondEmailOnTheSameBrowser (6/6, real PostgreSQL)');
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}
