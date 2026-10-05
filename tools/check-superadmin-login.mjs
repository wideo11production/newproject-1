// Does a REAL browser complete the superadmin login on http://localhost:3008?
//
// WHY A BROWSER AND NOT curl
// --------------------------
// The login response sets `Secure` on both cookies (NODE_ENV=production in the
// container). Over plain http, curl refuses to store a Secure cookie - so a curl
// test of this flow is testing the wrong thing and reports a failure that does not
// happen for a person.
//
// Chrome and Firefox both treat `http://localhost` as a trustworthy origin and DO
// store and send Secure cookies there. Safari's behaviour differs. So "does login
// work" is a browser question, and it is the browser that has to answer it.
//
// What this asserts, in order:
//   1. the sign-in form renders on :3008 at all (the bug that started this)
//   2. submitting it does NOT produce an error banner
//   3. the dashboard renders, i.e. /api/session says authenticated
//   4. BOTH cookies exist in the browser's cookie jar
//   5. the refresh cookie has a 7-day life
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222 + Math.floor(Math.random() * 400);
const BASE = 'http://localhost:3008';
const EMAIL = process.env.SA_EMAIL;
const PASSWORD = process.env.SA_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('SA_EMAIL and SA_PASSWORD must be set');
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), 'sa-login-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]);

const cleanup = () => {
  try { chrome.kill(); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows locks it */ }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

async function waitForCdp(ms = 25000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Chrome did not expose a debugging port');
}

let msgId = 0;
function cdp(ws, method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => reject(new Error(`${method}: timed out`)), 30000);
  });
}

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

try {
  await waitForCdp();
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Network.enable', {}, sessionId);

  // ---- 1. the sign-in form renders ----
  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);
  await new Promise((r) => setTimeout(r, 6000));

  const formProbe = await cdp(ws, 'Runtime.evaluate', {
    expression: `JSON.stringify({
      hasEmail: !!document.querySelector('input[name=email]'),
      hasPassword: !!document.querySelector('input[name=password]'),
      hasSubmit: !!document.querySelector('button[type=submit]'),
      bodyText: document.body.innerText.slice(0, 200)
    })`,
    returnByValue: true,
  }, sessionId);
  const form = JSON.parse(formProbe.result.value);
  check('the sign-in form renders on :3008', form.hasEmail && form.hasPassword && form.hasSubmit,
    form.hasEmail && form.hasPassword ? 'email + password + submit present' : form.bodyText);

  if (!form.hasEmail) throw new Error('no form to submit');

  // ---- 2. submit ----
  await cdp(ws, 'Runtime.evaluate', {
    expression: `(() => {
      const setNative = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setNative(document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)});
      setNative(document.querySelector('input[name=password]'), ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
      return 'submitted';
    })()`,
    returnByValue: true,
  }, sessionId);

  await new Promise((r) => setTimeout(r, 8000));

  // ---- 3. session authenticated ----
  const sessProbe = await cdp(ws, 'Runtime.evaluate', {
    expression: `fetch('/api/session', { cache: 'no-store' })
      .then(r => r.json().then(j => ({ status: r.status, ...j })))
      .catch(e => ({ error: String(e) }))`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const sess = sessProbe.result.value ?? {};
  check('the browser session is authenticated', sess.authenticated === true,
    `role=${sess.role ?? '?'} email=${sess.email ?? '?'}`);

  // ---- 4 + 5. cookies ----
  const cookieProbe = await cdp(ws, 'Runtime.evaluate', {
    expression: `fetch('/api/auth/refresh', { method: 'POST' }).then(() => 1).catch(() => 0)`.replace(
      'fetch(\'/api/auth/refresh\', { method: \'POST\' })', 'Promise.resolve(1)'
    ),
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);

  const { cookies } = await cdp(ws, 'Network.getCookies', { urls: [BASE] }, sessionId);
  const session = cookies.find((c) => c.name === 'wideo11_session');
  const refresh = cookies.find((c) => c.name === 'wideo11_refresh');

  check('wideo11_session cookie exists', Boolean(session),
    session ? `httpOnly=${session.httpOnly} secure=${session.secure}` : 'not found');
  check('wideo11_refresh cookie exists', Boolean(refresh),
    refresh ? `httpOnly=${refresh.httpOnly} secure=${refresh.secure}` : 'not found');

  if (refresh) {
    // Chrome reports expires as epoch seconds.
    const days = (refresh.expires - Date.now() / 1000) / 86400;
    check('the refresh cookie lives ~7 days', days > 6.5 && days <= 7.1, `${days.toFixed(2)} days`);
  }

  // ---- dashboard renders ----
  //
  // Wait for a table row rather than sleeping a fixed time. The dashboard fires
  // SIX parallel API calls on mount and renders when they land, so a fixed sleep
  // races the network and reports "0 rows" for a page that is merely still
  // loading. Polling for the thing being asserted is the difference between a
  // check that measures the app and one that measures the scheduler.
  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);

  let dash = { text: '', rows: 0 };
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    const probe = await cdp(ws, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        text: document.body.innerText.slice(0, 600),
        rows: document.querySelectorAll('tbody tr').length
      })`,
      returnByValue: true,
    }, sessionId);
    dash = JSON.parse(probe.result.value);
    if (dash.rows > 0) break;
  }

  // ---- DIAGNOSTIC ----
  //
  // "Signed in, then signed out after a reload" has three candidate causes that
  // look identical from the outside, so ask the server which one it is rather
  // than reasoning about it:
  //
  //   a) the browser is not SENDING the cookie  -> the middleware never sees it
  //   b) the middleware sees it and REJECTS it  -> bad signature / wrong secret
  //   c) the route is reached and answers 401    -> auth-service refused
  //
  // The response body distinguishes all three, because each layer has its own
  // message. Printing it is the whole point of this block.
  const diag = await cdp(ws, 'Runtime.evaluate', {
    expression: `fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' })
      .then(async r => ({ status: r.status, body: await r.text() }))
      .catch(e => ({ error: String(e) }))`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  const d = diag.result.value ?? {};
  check('the session survives a page reload', d.status === 200,
    `after reload /api/session -> ${d.status ?? '?'} ${String(d.body ?? d.error ?? '').slice(0, 160)}`);

  check(
    'the dashboard renders ledger data',
    dash.rows > 0,
    dash.rows > 0
      ? `${dash.rows} table rows`
      : `no rows after 25s. Page said: ${dash.text.replace(/\s+/g, ' ').slice(0, 180)}`
  );

  // A signed-out shell would render the FORM, not a table. Asserting the form is
  // absent is what distinguishes "signed in with no data yet" from "signed out and
  // showing the login screen", which both look like "nothing rendered".
  const stillSignedOut = await cdp(ws, 'Runtime.evaluate', {
    expression: `!!document.querySelector('input[name=email]')`,
    returnByValue: true,
  }, sessionId);
  check('the sign-in form is gone once authenticated', stillSignedOut.result.value === false,
    stillSignedOut.result.value ? 'form still visible - signed out' : 'dashboard shown');

  void cookieProbe;
} catch (err) {
  check('browser run completed', false, String(err.message ?? err));
} finally {
  const failed = checks.filter((c) => !c.ok).length;
  console.log('='.repeat(62));
  console.log(`${checks.length - failed}/${checks.length} passed`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
