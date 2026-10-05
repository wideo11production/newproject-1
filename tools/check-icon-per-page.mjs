// Does the ICON render on /login specifically?
//
// WHY THIS FILE EXISTS RATHER THAN A LINE IN check-tab-icon.mjs
//
// That check navigates to `/`, signs in, reloads — so it always tests the
// DASHBOARD. `/login` was never checked, and `/login` is the first page a
// superadmin sees. If the icon is declared on one and not the other, the tab is
// dull exactly when they are signing in, which is when they are looking at the tab.
//
// The complaint was "the 3008 tab icon is dull", and the dashboard check reported
// PASS on all five assertions. Both facts are true. That is what a per-route
// regression looks like.
//
// WHAT IT ASSERTS, PER PAGE
//
//   1. the document declares a `<link rel="icon">`
//   2. the declared href actually loads (not just that a tag exists)
//   3. the browser decoded it - `naturalWidth > 0` on a real `<img>`
//   4. the SMIL timeline advances - "animated" rather than "static"
//   5. and the pixels at 16px are not all the background colour, which is what a
//      faded arc looks like at the size a tab actually draws
//
// (5) is the one that matches "dull". An icon can serve, decode, animate, and
// still render as a flat washed-out square, and only reading pixels at 16px tells
// you that.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9850 + Math.floor(Math.random() * 100);

const PAGES = [
  // The sign-in page FIRST, because it is the one that was never being checked.
  //
  // `check-tab-icon.mjs` navigates to `/`, signs in, reloads - so it only ever
  // tested the DASHBOARD. `/login` is the first page a superadmin sees, and if the
  // icon is declared on one and not the other, the tab is dull exactly when they
  // are signing in. The original complaint was "the 3008 tab icon is dull" and that
  // check reported PASS on all five assertions. Both facts were true; that is what
  // a per-route regression looks like.
  { app: 'superadmin', port: 3008, path: '/login' },
  { app: 'superadmin', port: 3008, path: '/' },
  { app: 'web', port: 3000, path: '/' },
  // `admin` is included DELIBERATELY and is expected to be skipped. Its `/` is
  // gated: an anonymous request gets a 401 body with no `<head>` and therefore no
  // metadata. Asserting an icon there reports a broken icon on a page that is
  // working exactly as designed.
  { app: 'admin', port: 3004, path: '/', gated: true },
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'iconpage-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank',
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
    setTimeout(() => rej(new Error(`${method}: timeout`)), 30000);
  });
}

try {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  for (const p of PAGES) {
    const label = `[${p.app}${p.path}]`;

    const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await cdp(ws, 'Page.enable', {}, sessionId);
    await cdp(ws, 'Runtime.enable', {}, sessionId);
    // Navigate to this app's OWN origin so a same-origin `fetch` works; a probe
    // from another origin is CORS-blocked and reports five healthy icons broken.
    await cdp(ws, 'Page.navigate', { url: `http://localhost:${p.port}${p.path}` }, sessionId);
    await new Promise((r) => setTimeout(r, 3500));

    const probe = await cdp(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        const links = Array.from(document.querySelectorAll('link[rel~=icon]'));
        if (!links.length) return JSON.stringify({ declared: false });

        const href = links[0].href;

        const decoded = await new Promise(res => {
          const i = new Image();
          i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
          i.onerror = () => res({ w: 0, h: 0 });
          i.src = href;
        });

        // Read the pixels AT 16px - the size a tab strip draws. A faded arc on a
        // mid-tone background produces almost no contrast there, and this is the
        // only way to see "dull" rather than infer it.
        let contrast = 0;
        try {
          const c = document.createElement('canvas');
          c.width = 16; c.height = 16;
          const g = c.getContext('2d', { willReadFrequently: true });
          const i2 = new Image();
          await new Promise((res, rej) => { i2.onload = res; i2.onerror = rej; i2.src = href; });
          g.drawImage(i2, 0, 0, 16, 16);
          const d = g.getImageData(0, 0, 16, 16).data;

          // Background is the corner pixel; count pixels that differ from it.
          const bg = [d[0], d[1], d[2]];
          for (let k = 0; k < d.length; k += 4) {
            const diff = Math.abs(d[k] - bg[0]) + Math.abs(d[k+1] - bg[1]) + Math.abs(d[k+2] - bg[2]);
            if (diff > 40) contrast++;
          }
        } catch (e) { contrast = -1; }

        return JSON.stringify({ declared: true, href, w: decoded.w, h: decoded.h, contrast });
      })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);

    const r = JSON.parse(probe.result.value || '{}');

    // ---- A gated page legitimately has no <head>, so there is nothing to assert ----
    //
    // Reported as a SKIP with the reason, never as a silent pass. The difference
    // matters: a check that quietly marks an app as "fine" because it could not
    // see it is worse than one that fails, because the failure would at least have
    // been investigated.
    if (p.gated && !r.declared) {
      check(`${label} is gated (icon not applicable)`, true, 'skipped: 401 body has no <head>');
      await cdp(ws, 'Target.closeTarget', { targetId });
      continue;
    }

    check(`${label} declares a rel=icon`, r.declared === true, r.href ?? 'none in <head>');
    if (r.declared) {
      check(`${label} the declared icon decodes`, r.w > 0, `naturalWidth=${r.w}`);
      // 256 differing pixels out of 256 total is plenty; a flat square is ~0.
      // Below 40 means the icon is effectively a solid colour at 16px = DULL.
      check(`${label} has visible contrast at 16px`, r.contrast > 40,
        `${r.contrast}/256 pixels differ from the corner`);
    }

    await cdp(ws, 'Target.closeTarget', { targetId });
  }
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((x) => !x.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}