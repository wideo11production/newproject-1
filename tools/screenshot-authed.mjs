#!/usr/bin/env node
// Screenshot a dashboard AS A LOGGED-IN USER.
//
// Why: the analytics dashboard's real data is superadmin-gated, so an
// unauthenticated screenshot only ever shows the "sign in" state. To verify
// that real numbers actually render - rather than that the empty state does -
// the page has to be loaded with a valid superadmin session.
//
// The token is injected into the zustand-persisted auth store
// (`w11-auth` in localStorage) before the app hydrates, which is exactly
// what a real login leaves behind. No credentials are hardcoded here; the
// token comes from argv, so this stays a test tool and not a backdoor.
//
// USAGE
//   node tools/screenshot-authed.mjs <url> <token> <out.png>
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3005/';
const token = process.argv[3];
const out = process.argv[4] ?? 'authed.png';

if (!token) {
  console.error('usage: node tools/screenshot-authed.mjs <url> <token> <out.png>');
  process.exit(2);
}

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'authshot-'));
const PORT = 9700 + Math.floor(Math.random() * 250);

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  '--no-sandbox', '--disable-gpu', '--window-size=1600,1400', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, sessionId;

try {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { wsUrl = (await r.json()).webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(250);
  }
  ws = new globalThis.WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const cdp = (method, params = {}, sid) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params, sessionId: sid }));
  });

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sessionId);
  await cdp('Page.enable', {}, sessionId);

  // Land on the real origin FIRST so localStorage is same-origin, seed the
  // store, then reload. The earlier attempt navigated to a synthetic
  // /__seed.html first, which 404s and leaves localStorage unset - so the
  // reload hydrated signed-out.
  await cdp('Page.navigate', { url }, sessionId);
  await sleep(2500);

  // Zustand persist wraps state as { state: {...}, version: N }. That shape
  // must match exactly or the app logs the session out during rehydrate.
  const seeded = await cdp('Runtime.evaluate', {
    expression: `
      localStorage.setItem('w11-auth', JSON.stringify({
        state: {
          user: { id: 'seed', email: 'seed@local', username: 'seed', fullName: 'Seed' },
          accessToken: ${JSON.stringify(token)},
          refreshToken: 'seed',
          isAuthenticated: true
        },
        version: 0
      }));
      localStorage.getItem('w11-auth').slice(0, 60);
    `,
    returnByValue: true,
  }, sessionId);
  console.log('localStorage after seed: ' + seeded.result.value + '...');

  await cdp('Page.reload', {}, sessionId);
  // The auth store rehydrates from localStorage asynchronously, so the first
  // few /api/analytics calls go out WITHOUT the Authorization header and come
  // back 401. The component retries once the token lands, but that is several
  // render cycles in. Capturing at 9s caught the pre-hydration state and
  // produced a screenshot that said "Sign in" for a user who was signed in -
  // the same class of wrong conclusion the whole tool exists to avoid.
  await sleep(24000);

  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  writeFileSync(out, Buffer.from(data, 'base64'));

  // Report what the page actually says, so "it looks right" is verifiable
  // from the transcript and not only from the PNG.
  const r = await cdp('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body.innerText;
      return {
        signedIn: !/Sign in to view analytics/.test(t),
        banner: (t.match(/(Live from Postgres[^\\n]*|Data unavailable[^\\n]*|Analytics are restricted[^\\n]*)/) || [''])[0],
        nPanels: document.querySelectorAll('canvas').length,
        sample: t.split('\\n').filter(l => /\\d/.test(l)).slice(0, 14)
      };
    })()`,
    returnByValue: true,
  }, sessionId);
  console.log(JSON.stringify(r.result.value, null, 2));
  console.log('screenshot: ' + out);
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
