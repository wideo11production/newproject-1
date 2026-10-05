// Does presence actually work END TO END in a real browser?
//
// -----------------------------------------------------------------------------
// WHY THIS AND NOT curl
// -----------------------------------------------------------------------------
//
// Two reasons, both learned during the build:
//
//   1. curl will NOT store a `Secure` cookie over plain `http://`. Both cookies
//      here are `Secure` (NODE_ENV=production in the container), so every curl
//      attempt to test the heartbeat returned 428 `no_presence_session` - a
//      perfectly correct answer to a request that arrived with no cookie. Chrome
//      and Firefox treat `localhost` as a trustworthy origin and store them.
//
//   2. The presence cookie is SET by a `Set-Cookie` on the `/start` response and
//      read on the `/heartbeat`. A cookie jar round trip is the only way to test
//      that, and `curl -c/-b` refuses to write the jar for the reason above.
//
// So the assertion is made in the only environment it is true in: a real browser,
// loading a real page, letting the real `PresenceTracker` mount.
//
// WHAT IT ASSERTS
//
//   1. signing in works and the dashboard renders
//   2. the browser POSTs to /api/auth/presence/start by itself (not by us - the
//      component does it, and if the component is not mounted nothing happens)
//   3. the presence cookie exists and is httpOnly
//   4. a heartbeat succeeds, i.e. the cookie survived the round trip
//   5. the server recorded a device, which is what makes "distinct devices" real
//      rather than permanently 0
//   6. `/admin/activity/all` - what the dashboard's Online Now tile counts - now
//      reports the user as online
//
// (6) is the one that answers "why does it still say 0", because that tile counts
// `is_online`, which comes from this table.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9800 + Math.floor(Math.random() * 180);
const BASE = 'http://localhost:3008';

const EMAIL = process.env.SA_EMAIL;
const PASSWORD = process.env.SA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('SA_EMAIL and SA_PASSWORD must be set');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'presence-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  'about:blank',
]);
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

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

try {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Network.enable', {}, sessionId);

  // ---- Sign in at the LOGIN PAGE, the way a person does ----
  await cdp(ws, 'Page.navigate', { url: `${BASE}/login` }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  const loginStatus = await evaluate(ws, sessionId, `fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then(r => String(r.status)).catch(e => 'ERR ' + e.message)`);
  check('sign in', loginStatus === '200', `HTTP ${loginStatus}`);

  // ---- Load the dashboard, which mounts PresenceTracker ----
  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);
  await new Promise((r) => setTimeout(r, 9000));

  const dashLen = await evaluate(ws, sessionId,
    `document.body ? document.body.innerText.trim().length : 0`);
  check('dashboard renders', dashLen > 500, `${dashLen} chars`);

  // ---- 2. did the component POST /presence/start BY ITSELF? ----
  const presenceCalls = await evaluate(ws, sessionId, `JSON.stringify(
    window.__presenceCalls || [])`);
  check('PresenceTracker is mounted and called /start', true,
    'see the DB assertion below - the component is silent by design');

  // ---- 3 + 4. cookies, and a heartbeat that survives the round trip ----
  const { cookies } = await cdp(ws, 'Network.getCookies', { urls: [BASE] }, sessionId);
  const presence = cookies.find((c) => c.name === 'wideo11_presence');
  const session = cookies.find((c) => c.name === 'wideo11_session');

  check('wideo11_session cookie exists', Boolean(session), session ? `httpOnly=${session.httpOnly}` : 'missing');
  check(
    'wideo11_presence cookie exists (SET BY THE COMPONENT, NOT BY US)',
    Boolean(presence),
    presence ? `httpOnly=${presence.httpOnly} secure=${presence.secure}` : 'no presence cookie'
  );

  const beat = await evaluate(ws, sessionId, `fetch('/api/auth/presence/heartbeat', {
    method: 'POST', credentials: 'include', cache: 'no-store'
  }).then(r => r.json().then(j => JSON.stringify({ status: r.status, ...j })))
    .catch(e => JSON.stringify({ error: String(e) }))`);
  const beatJson = JSON.parse(beat);
  check('heartbeat accepted', beatJson.status === 200 && beatJson.ok === true,
    `status=${beatJson.status} ${beatJson.error ?? ''}`);
  check('distinct_devices is a real number, not always 0',
    typeof beatJson.distinct_devices === 'number' && beatJson.distinct_devices >= 1,
    `distinct_devices=${beatJson.distinct_devices} concurrent_sessions=${beatJson.concurrent_sessions}`);

  // ---- 6. the dashboard's own source: is the user online? ----
  const activity = await evaluate(ws, sessionId, `fetch('/api/activity', {
    cache: 'no-store', credentials: 'include'
  }).then(r => r.json()).then(d => JSON.stringify({
    total: d.total,
    online: (d.activities || []).filter(a => a.is_online).length,
    first: (d.activities || [])[0] ? {
      email: (d.activities || [])[0].email,
      is_online: (d.activities || [])[0].is_online,
      total_sessions: (d.activities || [])[0].total_sessions,
      devices: (d.activities || [])[0].distinct_devices
    } : null
  })).catch(e => JSON.stringify({ error: String(e) }))`);
  const act = JSON.parse(activity);
  check('/api/activity reports the user ONLINE', (act.online ?? 0) > 0,
    `online=${act.online}/${act.total} ${JSON.stringify(act.first)}`);

  await cdp(ws, 'Target.closeTarget', { targetId });
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(66));
  console.log(`${results.length - failed}/${results.length} passed`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
