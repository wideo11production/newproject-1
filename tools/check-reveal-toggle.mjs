// Does the show/hide toggle actually REVEAL, and does it survive a form?
//
// WHY THIS IS A BROWSER TEST AND NOT A SNAPSHOT
//
// A snapshot of a password field shows six dots whether the toggle works or not.
// The only way to tell a working toggle from a decorative one is to type a known
// value, click the eye, and read what is rendered. So that is exactly what this
// does, and it reads `input.type` rather than the pixels — `type` is the property
// the whole feature turns on, and asserting it is precise where asserting an image
// is guesswork.
//
// -----------------------------------------------------------------------------
// THE BUG THIS IS GUARDING AGAINST
// -----------------------------------------------------------------------------
//
// The toggle button lives inside `<form>`. A `<button>` with no `type` defaults to
// `type="submit"`, so clicking the eye would SUBMIT the form — saving a half-typed
// PIN, or navigating away from a password confirmation mid-keystroke.
//
// It looks correct in review: a button, an onClick, an icon. It is the kind of bug
// that passes a type check, passes a build, and only shows up when somebody uses
// the thing. So this asserts the form was NOT submitted.
//
// A third assertion is the one that makes it a real test: that clicking REVEALS.
// `input.type === 'text'` after the click. Everything else is setup.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9200 + Math.floor(Math.random() * 80);
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

const profile = mkdtempSync(join(tmpdir(), 'reveal-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,1400', 'about:blank',
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

/** Sets a React-controlled input's value the way React actually notices. */
const setValue = (id, value) => `(() => {
  const el = document.getElementById(${JSON.stringify(id)});
  if (!el) return 'missing';
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.type;
})()`;

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

  await cdp(ws, 'Page.navigate', { url: `${BASE}/dashboard/settings` }, sessionId);

  // The PIN card is locked until a current PIN is supplied, so the first thing on
  // the page is the password card's "Current password" field.
  let deadline = Date.now() + 25000;
  let found = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    found = String(await evaluate(ws, sessionId, `document.body ? document.body.innerText : ''`) ?? '');
    if (/Current password|Reset password|New password/i.test(found)) break;
  }

  const path = String(await evaluate(ws, sessionId, 'location.pathname') ?? '');
  check('settings page loaded', /Settings/i.test(found) || !!path.match(/settings/), `path=${path}`);

  // ---- A BEFORE-count so we can prove the form was not submitted ----
  const urlBefore = String(await evaluate(ws, sessionId, 'location.href') ?? '');

  // ---------------------------------------------------------------- PIN field
  //
  // `currentPin` is on the locked PIN card. Test it the same way as the password
  // fields: type, click the eye, read the type.
  const pinPresent = await evaluate(ws, sessionId, `!!document.getElementById('currentPin')`);
  if (pinPresent) {
    const before = await evaluate(ws, sessionId, setValue('currentPin', '123456'));
    check('PIN field starts hidden', before === 'password', `type=${before}`);

    await evaluate(ws, sessionId, `(() => {
      const el = document.getElementById('currentPin');
      const btn = el.parentElement.querySelector('button[type=button]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await new Promise((r) => setTimeout(r, 350));
    const after = await evaluate(ws, sessionId, `document.getElementById('currentPin').type`);
    check('PIN REVEALS on click', after === 'text', `type=${after}`);

    const urlAfterPin = String(await evaluate(ws, sessionId, 'location.href') ?? '');
    check('clicking the eye did NOT submit the form', urlAfterPin === urlBefore,
      urlAfterPin === urlBefore ? 'url unchanged' : `${urlBefore} -> ${urlAfterPin}`);

    // Click again to hide, and prove the value SURVIVED — clearing it would be a
    // small act of vandalism, since the person clicked to SEE their input.
    await evaluate(ws, sessionId, `(() => {
      const el = document.getElementById('currentPin');
      const btn = el.parentElement.querySelector('button[type=button]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await new Promise((r) => setTimeout(r, 350));
    const hidden = await evaluate(ws, sessionId,
      `JSON.stringify({ type: document.getElementById('currentPin').type, value: document.getElementById('currentPin').value })`);
    const h = JSON.parse(hidden);
    check('PIN hides again and KEEPS its value', h.type === 'password' && h.value === '123456',
      `type=${h.type} value="${h.value}"`);
  } else {
    check('PIN field present on the page', false, 'currentPin not rendered (card may be collapsed)');
  }

  // ------------------------------------------------------- password field
  const pwPresent = await evaluate(ws, sessionId, `!!document.getElementById('curPw')`);
  check('password field present', pwPresent === true, `curPw present=${pwPresent}`);

  if (pwPresent) {
    const before = await evaluate(ws, sessionId, setValue('curPw', 'SuperSecret123'));
    check('password starts hidden', before === 'password', `type=${before}`);

    await evaluate(ws, sessionId, `(() => {
      const el = document.getElementById('curPw');
      const btn = el.parentElement.querySelector('button[type=button]');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await new Promise((r) => setTimeout(r, 350));

    const state = JSON.parse(String(await evaluate(ws, sessionId,
      `(() => { const el = document.getElementById('curPw');
         return JSON.stringify({ type: el.type, value: el.value }); })()`) ?? '{}'));

    check('password REVEALS on click', state.type === 'text', `type=${state.type}`);
    check('revealed value is correct', state.value === 'SuperSecret123', `value="${state.value}"`);

    const urlAfter = String(await evaluate(ws, sessionId, 'location.href') ?? '');
    check('clicking the eye did NOT submit the form (password)', urlAfter === urlBefore,
      urlAfter === urlBefore ? 'url unchanged' : `${urlBefore} -> ${urlAfter}`);

    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, 'settings-reveal-toggle.png'), Buffer.from(shot.data, 'base64'));
  }

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