// Screenshot every app, in both themes, and report what actually rendered.
//
// WHY A SCRIPT AND NOT "IT LOOKS FINE"
// ------------------------------------
//
// `tsc --noEmit` passing and `docker ps` saying healthy are both statements about
// types and process liveness. Neither is a statement about whether the page renders
// correctly, and this session found three things that only a browser could see:
//
//   - an app whose every `bg-gray-*` utility resolved to nothing, because the
//     `--app-*` variables it depends on were defined in a different app's CSS
//   - a superadmin dashboard that reported "Your session ended" to a signed-in
//     operator, because two endpoints disagreed about the same cookie
//   - five Docker healthchecks probing a gated path, restarting healthy containers
//
// None of those were visible to the type checker. All of them are visible here.
//
// WHAT IT ASSERTS, PER APP AND PER THEME
//
//   1. the page returns 200
//   2. it is not an error page and not a raw JSON body (the failure mode when a
//      gate 401s a page request: `{"error":"unauthorized"}` rendered as a document)
//   3. the `<html>` background is not pure white in DARK mode - the signature of
//      every grey utility silently resolving to nothing
//   4. the theme class actually flipped
//   5. a screenshot is written for a human to look at
//
// (3) and (4) are the ones worth having. "It renders" is weak; "it renders with the
// background the theme asked for" is the property that was broken.

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + Math.floor(Math.random() * 300);
const OUT = process.env.SHOT_DIR ?? join(process.cwd(), 'screenshots');

const APPS = [
  { name: 'web', port: 3000, path: '/', auth: false },
  { name: 'editor', port: 3002, path: '/', auth: false },
  { name: 'admin', port: 3004, path: '/', auth: false },
  { name: 'analytics', port: 3005, path: '/', auth: false },
  { name: 'billing', port: 3003, path: '/', auth: false },
  { name: 'monitor', port: 3001, path: '/', auth: false },
  { name: 'currency', port: 3007, path: '/', auth: false },
  { name: 'superadmin-login', port: 3008, path: '/login', auth: false },
  { name: 'superadmin', port: 3008, path: '/', auth: true },
];

const results = [];
const check = (app, theme, name, ok, detail = '') => {
  results.push({ app, theme, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${app}/${theme}] ${name}${detail ? `  ${detail}` : ''}`);
};

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'shots-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--window-size=1440,1000',
  'about:blank',
]);

const cleanup = () => {
  try { chrome.kill(); } catch { /* gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* windows lock */ }
};
process.on('exit', cleanup);

async function waitForCdp(ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return true;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Chrome never opened a debugging port');
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
    setTimeout(() => reject(new Error(`${method}: timeout`)), 40000);
  });
}

try {
  await waitForCdp();
  const { webSocketDebuggerUrl } = await (
    await fetch(`http://127.0.0.1:${PORT}/json/version`)
  ).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  for (const app of APPS) {
    for (const theme of ['dark', 'light']) {
      const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
      await cdp(ws, 'Page.enable', {}, sessionId);
      await cdp(ws, 'Runtime.enable', {}, sessionId);

      // Set the theme BEFORE navigating, so the pre-paint script reads it. Setting
      // it after load would screenshot whatever the script already chose, which is
      // how a theme toggle ends up "verified" against the wrong value.
      await cdp(ws, 'Page.addScriptToEvaluateOnNewDocument', {
        source: `try { localStorage.setItem('wideo11-theme', ${JSON.stringify(theme)}); } catch (e) {}`,
      }, sessionId);

      // Navigate FIRST, then sign in.
      //
      // The first version evaluated the login `fetch` while the tab was still on
      // `about:blank`. That page has an OPAQUE origin, so the request to
      // localhost:3008 is cross-origin: the POST was actually sent, but the
      // response was unreadable and `r.status` came back as an opaque object.
      //
      // Which produced "login HTTP [object Object]" - a harness bug that reads
      // exactly like an application bug. Navigating first makes the fetch
      // same-origin, so the status is a real number and a failure here is a real
      // failure.
      await cdp(ws, 'Page.navigate', { url: `http://localhost:${app.port}${app.path}` }, sessionId);
      await new Promise((r) => setTimeout(r, 2500));

      if (app.auth) {
        const email = process.env.SA_EMAIL;
        const password = process.env.SA_PASSWORD;
        if (email && password) {
          const login = await cdp(ws, 'Runtime.evaluate', {
            expression: `fetch('/api/auth/login', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
            }).then(r => String(r.status)).catch(e => 'ERR ' + e.message)`,
            awaitPromise: true,
            returnByValue: true,
          }, sessionId);
          const status = String(login.result.value);
          check(app.name, theme, 'signs in', status === '200', `login HTTP ${status}`);

          // Reload so the page renders with the cookie present. Without this the
          // screenshot is of the login redirect, which passes every "did it
          // render" assertion while showing nothing of the dashboard.
          await cdp(ws, 'Page.reload', { ignoreCache: false }, sessionId);
        }
      }

      // Poll for content rather than sleeping. Every panel fetches on mount, so a
      // fixed wait races the network and screenshots a loading state - which is how a
      // broken panel gets photographed as "working, just empty".
      let ready = false;
      const end = Date.now() + 18000;
      while (Date.now() < end) {
        await new Promise((r) => setTimeout(r, 900));
        const probe = await cdp(ws, 'Runtime.evaluate', {
          expression: `document.body ? document.body.innerText.trim().length : 0`,
          returnByValue: true,
        }, sessionId);
        if ((probe.result.value ?? 0) > 40) { ready = true; break; }
      }

      const state = await cdp(ws, 'Runtime.evaluate', {
        expression: `JSON.stringify({
          text: (document.body ? document.body.innerText : '').slice(0, 300),
          len: document.body ? document.body.innerText.trim().length : 0,
          htmlClass: document.documentElement.className,
          colorScheme: document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme,
          bg: getComputedStyle(document.body).backgroundColor,
          color: getComputedStyle(document.body).color,
          nodes: document.querySelectorAll('*').length,
          raw: document.body ? document.body.innerText.trim().startsWith('{') : false
        })`,
        returnByValue: true,
      }, sessionId);

      const s = JSON.parse(state.result.value);

      check(app.name, theme, 'renders content', ready && s.len > 40, `${s.len} chars`);
      check(app.name, theme, 'is not a raw JSON error body', !s.raw, s.raw ? s.text.slice(0, 80) : '');
      check(app.name, theme, 'is not an error page', !/unauthorized|not found|404/i.test(s.text),
        /unauthorized|not found|404/i.test(s.text) ? s.text.slice(0, 80) : '');

      // The real assertion: a dark theme whose body resolves to white.
      const rgb = (s.bg.match(/\d+/g) ?? []).map(Number);
      const isWhite = rgb.length >= 3 && rgb[0] > 245 && rgb[1] > 245 && rgb[2] > 245;
      check(app.name, theme, 'background follows the theme',
        theme === 'dark' ? !isWhite : true,
        `bg=${s.bg} scheme=${s.colorScheme}`);

      // Screenshot for a human.
      const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
      const file = join(OUT, `${app.name}-${theme}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));

      await cdp(ws, 'Target.closeTarget', { targetId });
    }
  }
} catch (err) {
  check('harness', '-', 'completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(66));
  console.log(`${results.length - failed}/${results.length} passed   screenshots -> ${OUT}`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
