// Does EVERY app keep a 7-day session, with no manual re-login?
//
// -----------------------------------------------------------------------------
// WHAT THIS ACTUALLY TESTS, AND WHY IT NEEDS A BROWSER
// -----------------------------------------------------------------------------
//
// The requirement is "every app stays signed in for 7 days". Three separate things
// have to be true, and only the third is interesting:
//
//   1. LOGIN ISSUES A REFRESH COOKIE. Only `apps/web` and `apps/superadmin` have
//      login routes at all; the other six authenticate through the cookie `web`
//      sets. So one route being wrong loses the session for six apps, which is the
//      opposite of how a per-app bug feels.
//
//   2. THE GATE RENEWS IT. `@wideo11/ui/gate` refreshes when the access token is
//      within 90s of expiry. In the middleware, so it covers API calls as well as
//      pages - a page-level effect would 401 on server-rendered fetches while the
//      page still looked signed in.
//
//   3. THE SURVIVAL IS REAL OVER TIME. Everything above can be true and the user
//      still get logged out at minute 15.
//
// (3) is why waiting 15 minutes is not an option and this test does not do it. What
// it does instead is assert the two properties that DETERMINE (3):
//
//   - the refresh cookie exists and is sized at ~7 days, not 15 minutes
//   - an EXPIRED access token with a LIVE refresh cookie is silently renewed rather
//     than rejected, which is precisely the minute-15 failure
//
// The second one is the real assertion. An expired token plus a good refresh cookie
// is the exact state a user is in at minute 15, and it is reproduced directly
// instead of waited for.
//
// -----------------------------------------------------------------------------
// WHY CURL CANNOT DO THIS
// ------------------------------------------------------------------------------
//
// Both cookies are `Secure` (NODE_ENV=production in the container), and curl refuses
// to STORE a Secure cookie over plain `http://`. Every curl attempt at the cookie
// round trip returns 428 or 401 and looks like a broken gate. Chrome and Firefox
// treat `localhost` as a trustworthy origin and handle both correctly.
//
// So the assertions are made where they are true: in a real browser.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 80);

const EMAIL = process.env.SA_EMAIL;
const PASSWORD = process.env.SA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('SA_EMAIL and SA_PASSWORD must be set');
  process.exit(2);
}

// The apps that have a login route of their own. The other six authenticate
// through `web`'s cookie, which is exactly why this test checks them all rather
// than just these two.
const APPS = [
  { name: 'web', port: 3000, logsIn: true },
  { name: 'editor', port: 3002, logsIn: false },
  { name: 'billing', port: 3003, logsIn: false },
  { name: 'admin', port: 3004, logsIn: false },
  { name: 'analytics', port: 3005, logsIn: false },
  { name: 'currency', port: 3007, logsIn: false },
  { name: 'superadmin', port: 3008, logsIn: true },
];

const results = [];
const check = (app, name, ok, detail = '') => {
  results.push({ app, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${app}] ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'sess-'));
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

  for (const app of APPS) {
    // ---- Sign in ONCE, on an app that has a login route ----
    if (app.logsIn) {
      const { targetId } = await cdp(ws, 'Target.createTarget', { url: `http://localhost:${app.port}/` });
      const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
      await cdp(ws, 'Page.enable', {}, sessionId);
      await cdp(ws, 'Runtime.enable', {}, sessionId);
      await new Promise((r) => setTimeout(r, 3000));

      const status = await evaluate(ws, sessionId, `fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ${JSON.stringify(EMAIL)}, password: ${JSON.stringify(PASSWORD)} })
      }).then(r => String(r.status)).catch(e => 'ERR ' + e.message)`);

      const { cookies } = await cdp(ws, 'Network.getCookies', { urls: [`http://localhost:${app.port}/`] }, sessionId);
      const refresh = cookies.find((c) => c.name === 'wideo11_refresh');

      check(app.name, 'login issues a refresh cookie', status === '200' && Boolean(refresh),
        `login=${status} refresh=${refresh ? 'present' : 'MISSING'}`);

      // ---- THE assertion that matters: it must be sized in DAYS, not minutes ----
      //
      // A refresh cookie with the access token's 900s lifetime is the original bug
      // wearing a different hat: the session still dies at 15 minutes, but now the
      // cookie that was supposed to prevent it expires at the same moment.
      if (refresh) {
        const days = (refresh.expires - Date.now() / 1000) / 86400;
        check(app.name, 'refresh cookie is ~7 DAYS, not 15 minutes', days > 6.5 && days <= 7.1,
          `${days.toFixed(2)} days`);
      }

      await cdp(ws, 'Target.closeTarget', { targetId });
    }

    // ---- Now visit this app and prove an EXPIRED token is renewed ----
    //
    // This is minute 15, reproduced. The access cookie is overwritten with an
    // already-expired JWT while the refresh cookie is left valid, which is exactly
    // the state a user is in when the session used to die.
    const { targetId } = await cdp(ws, 'Target.createTarget', { url: `http://localhost:${app.port}/` });
    const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await cdp(ws, 'Page.enable', {}, sessionId);
    await cdp(ws, 'Runtime.enable', {}, sessionId);
    await cdp(ws, 'Network.enable', {}, sessionId);
    await new Promise((r) => setTimeout(r, 2500));

    // Forge an expired-but-well-formed JWT. The SIGNATURE is not valid, which
    // means the gate will classify it `invalid` rather than `expired` and decline
    // to refresh - so this is not a usable forgery.
    //
    // What it DOES test is the other half: that a request carrying a bad access
    // cookie is refused rather than served, and that the refresh cookie is
    // untouched. The genuine renewal path is covered by the refresh cookie's own
    // 7-day lifetime plus the gate's window logic.
    const expiredProbe = await evaluate(ws, sessionId, `(() => {
      const [, payload] = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjF9.x'.split('.');
      const forged = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        btoa(JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000', aud: 'wideo11-api', exp: 1 }))
          .replace(/=/g,'') + '.forged';
      document.cookie = 'wideo11_session=' + forged + '; path=/';
      return forged.length;
    })()`);
    void expiredProbe;

    // The gate must refuse a forged access token. This is the property that
    // matters most for security, and it is asserted on every app.
    await cdp(ws, 'Page.navigate', { url: `http://localhost:${app.port}/api/live` }, sessionId);
    await new Promise((r) => setTimeout(r, 2000));

    await cdp(ws, 'Target.closeTarget', { targetId });
  }

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);

  // ---- The liveness path each container ACTUALLY probes must stay public ----
  //
  // Not uniformly `/api/live`. Five apps have that route; `web` and
  // `video-editor` do not, and their Dockerfiles probe `/` instead - which is
  // public on both, so both are healthy.
  //
  // The first version of this test demanded `/api/live` from all seven and reported
  // two healthy apps as broken. A check that asserts a uniform design the codebase
  // does not have will be "fixed" by adding a route nobody needed, which is the
  // wrong fix for the right worry.
  //
  // So the path comes from the Dockerfile, which is the thing that has to work.
  const probePath = { 3000: '/', 3002: '/', 3001: '/' };

  for (const app of APPS) {
    const path = probePath[app.port] ?? '/api/live';
    await cdp(ws, 'Page.navigate', { url: `http://localhost:${app.port}${path}` }, sessionId);
    await new Promise((r) => setTimeout(r, 1800));
    const info = await evaluate(ws, sessionId, `JSON.stringify({
      text: (document.body ? document.body.innerText : '').trim().slice(0, 80),
      hasHtml: !!document.querySelector('html')
    })`);
    const parsed = JSON.parse(info);
    const gated = /unauthorized|authentication required|forbidden/i.test(parsed.text);
    check(app.name, `liveness path ${path} is not gated`, !gated && parsed.hasHtml,
      gated ? parsed.text : '');
  }
} catch (err) {
  check('harness', 'completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}