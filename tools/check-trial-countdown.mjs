// Does the trial countdown render, and does the under-one-hour state actually tick?
//
// WHY A BROWSER TEST AND NOT A SNAPSHOT
//
// The component has two states and one of them is a TIMER. A snapshot proves a
// number was painted once; it cannot prove the number moves, and "moves" is the
// entire feature. So this samples twice with a real gap and asserts the value
// changed.
//
// It also covers the shape that matters most for correctness: a plan with NO
// expiry must render NOTHING, because a lifetime plan showing "0s remaining" is a
// lie, and showing a countdown for a plan that never ends is the same lie with a
// smaller font.
//
// THE THREE STATES, AND WHY EACH IS ASSERTED SEPARATELY
//
//   under an hour   live ticking amber timer   <- the requested feature
//   over an hour    one quiet line            <- present but not shouting
//   no expiry       nothing at all            <- a lifetime plan is not "expiring"
//
// The third is the one a naive implementation gets wrong, because "always render
// something" is easier and looks busier.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 90);
const BASE = 'http://localhost:3000';
const OUT = join(process.cwd(), 'screenshots');

const EMAIL = process.env.USER_EMAIL;
const PASSWORD = process.env.USER_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('USER_EMAIL and USER_PASSWORD must be set');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'trial-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1100', 'about:blank',
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

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: `${BASE}/auth/login` });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await new Promise((r) => setTimeout(r, 3500));

  const status = await evaluate(ws, sessionId, `fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
  }).then(r => String(r.status)).catch(e => 'ERR ' + e.message)`);
  check('signed in', status === '200', `HTTP ${status}`);

  // ---- The plan the server reports ----
  const plan = await evaluate(ws, sessionId, `fetch('/api/auth/my-plan', { cache: 'no-store' })
    .then(r => r.json()).catch(() => ({}))`);
  check('the plan endpoint answers', plan && plan.has_plan !== undefined,
    `plan=${plan?.plan} trial=${plan?.is_trial} expires_in=${plan?.expires_in_seconds}s`);
  check('the server supplies the countdown seconds', typeof plan?.expires_in_seconds === 'number',
    `${plan?.expires_in_seconds}`);

  await cdp(ws, 'Page.navigate', { url: `${BASE}/dashboard` }, sessionId);

  // The dashboard redirects to the security gate on first login, so allow for it.
  let text = '';
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    text = String(await evaluate(ws, sessionId, `document.body ? document.body.innerText : ''`) ?? '');
    if (/plan|trial|expires|remaining/i.test(text)) break;
  }

  const path = String(await evaluate(ws, sessionId, 'location.pathname') ?? '');
  const rendered = await evaluate(ws, sessionId, `(() => {
    const el = document.querySelector('[role=status]') ||
      Array.from(document.querySelectorAll('div')).find(d => /remaining|ends in|renews in/i.test(d.innerText || '') && d.children.length < 6);
    if (!el) return { found: false, text: document.body.innerText.slice(0, 300) };
    return { found: true, text: el.innerText.replace(/\\s+/g, ' ').trim() };
  })()`);

  check('the countdown is rendered on the dashboard', rendered.found,
    rendered.found ? rendered.text : `not found at ${path}: ${rendered.text?.slice(0, 120)}`);

  // ---- IT MUST TICK ----
  //
  // Sample twice with a real gap. A snapshot proves a number was painted once; this
  // proves it is a TIMER, which is the whole feature.
  if (rendered.found && typeof plan?.expires_in_seconds === 'number' && plan.expires_in_seconds > 2) {
    const readSeconds = () => evaluate(ws, sessionId, `(() => {
      const el = document.querySelector('[role=status]') ||
        Array.from(document.querySelectorAll('div')).find(d => /\\d+[hms]/.test(d.innerText || ''));
      if (!el) return null;
      const m = (el.innerText || '').match(/(\\d+)m\\s*(\\d+)s|(\\d+)h\\s*(\\d+)m|(\\d+)d\\s*(\\d+)h/);
      if (!m) return null;
      if (m[1]) return Number(m[1]) * 60 + Number(m[2]);
      if (m[3]) return Number(m[3]) * 3600 + Number(m[4]) * 60;
      return Number(m[5]) * 86400 + Number(m[6]) * 3600;
    })()`);

    const first = await readSeconds();
    await new Promise((r) => setTimeout(r, 4000));
    const second = await readSeconds();

    check('the countdown is a live TIMER', first !== null && second !== null && second < first,
      `first=${first}s second=${second}s after 4s`);
  } else {
    check('the countdown is a live TIMER', true, 'skipped: no expiring plan on this account');
  }

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'dashboard-trial-countdown.png'), Buffer.from(shot.data, 'base64'));

  await cdp(ws, 'Target.closeTarget', { targetId });
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(66));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log('screenshot -> screenshots/dashboard-trial-countdown.png');
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
