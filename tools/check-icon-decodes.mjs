// Can the browser actually DISPLAY each app's favicon?
//
// -----------------------------------------------------------------------------
// WHY DECODE TESTING, NOT PARSING
// -----------------------------------------------------------------------------
//
// `check-icon-svg.mjs` parses each file and reports 24/24. That is not sufficient,
// and this file exists because it was not.
//
// Three separate things can go wrong, and only the third is a decode failure:
//
//   1. THE XML IS MALFORMED. Caught by parsing. This is how the superadmin icon's
//      `-----` comment was found - the whole document was rejected.
//   2. THE SVG IS VALID BUT UNUSABLE AS AN IMAGE. An SVG in an `<img>` is loaded
//      in a SANDBOX: no scripts, no external references, and it must carry its own
//      intrinsic size or a `viewBox` to be laid out. A perfectly well-formed SVG
//      missing that renders as a broken-image glyph, and no parser notices.
//   3. IT DECODES AND RENDERS. Only `img.naturalWidth > 0` after a load event
//      proves this.
//
// So the assertion is (3), reached by drawing the real bytes into a real `<img>`
// and asking the browser whether it got pixels. Everything else is a proxy that
// has already been wrong at least once today.
//
// THE SCREENSHOT THAT PROVED IT
//
// `render-icons.mjs` laid every icon out at 16/32/128px and every one came back as
// Chrome's broken-image placeholder. Parsing had said 24/24 the whole time. That
// gap - "correct" and "displays" are different claims - is what this file closes.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9950 + Math.floor(Math.random() * 40);

const APPS = [
  { name: 'web', port: 3000 },
  { name: 'monitor', port: 3001 },
  { name: 'editor', port: 3002 },
  { name: 'admin', port: 3004 },
  { name: 'analytics', port: 3005 },
  { name: 'superadmin', port: 3008 },
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'decode-'));
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

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Page.navigate', { url: 'http://localhost:3000/' }, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  for (const app of APPS) {
    // ---- Navigate to the app's OWN origin before probing it ----
    //
    // `fetch()` is CORS-restricted, so probing `localhost:3001/icon.svg` from a page
    // served by `localhost:3000` throws and the probe returns nothing. The first
    // version of this loop probed every app from one origin, so exactly one app -
    // whichever shared the test page's origin - ever reported, and the other five
    // were reported as broken. Five healthy icons, five failures, caused entirely
    // by where the test was standing.
    //
    // Navigating per app makes the probe same-origin, so `fetch` works and the
    // result is about the icon rather than about the test's location.
    await cdp(ws, 'Page.navigate', { url: `http://localhost:${app.port}/` }, sessionId);
    await new Promise((r) => setTimeout(r, 2500));

    const src = `http://localhost:${app.port}/icon.svg`;

    const probe = await cdp(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        const url = ${JSON.stringify(src)};

        // ---- (1) parse ----
        const text = await fetch(url).then(r => r.text());
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const parseErr = doc.querySelector('parsererror');

        // ---- (2) decode into a real <img> ----
        //
        // naturalWidth > 0 after the load event is the decode signal. There is
        // deliberately NO canvas pixel check here.
        //
        // The first version drew the image into a canvas and read the pixels back,
        // and it worked for the app whose origin the test page was served from, and
        // THREW a SecurityError for every other app - because drawing a cross-origin
        // image taints the canvas and getImageData then refuses. The crash looked
        // exactly like "this icon is broken" for five healthy apps.
        //
        // Getting real pixels out of a cross-origin image needs
        // crossOrigin="anonymous" plus CORS headers on the icon route, which is a
        // production change made purely to satisfy a test. So the canvas check is
        // gone rather than half-working: naturalWidth is the honest signal for
        // "did the browser decode this", and it is the question being asked.
        const loaded = await new Promise(resolve => {
          const img = new Image();
          img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 0, h: 0 });
          img.src = url;
        });

        const root = doc.documentElement;
        return JSON.stringify({
          parseError: parseErr ? parseErr.textContent.split('\\n')[0] : null,
          root: root ? root.nodeName : null,
          hasViewBox: root ? root.hasAttribute('viewBox') : false,
          hasWidth: root ? root.hasAttribute('width') : false,
          hasHeight: root ? root.hasAttribute('height') : false,
          naturalW: loaded.w, naturalH: loaded.h
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);

    let r;
    try {
      r = JSON.parse(probe.result.value);
    } catch {
      // One app throwing must not end the run. The previous version aborted the
      // whole suite on the first exception, so four healthy apps after the failing
      // one were never checked - and the report said "1 failed" when in fact the
      // check had only run once.
      r = { parseError: 'probe returned non-JSON', naturalW: 0, naturalH: 0,
             hasViewBox: false, hasWidth: false, hasHeight: false };
    }

    check(`${app.name}: parses`, !r.parseError, r.parseError ?? '');
    check(`${app.name}: DECODES as an image`, r.naturalW > 0 && r.naturalH > 0,
      `naturalWidth=${r.naturalW} naturalHeight=${r.naturalH}`);
    check(`${app.name}: has a viewBox`, r.hasViewBox,
      `viewBox=${r.hasViewBox} width=${r.hasWidth} height=${r.hasHeight}`);
  }
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((x) => !x.ok).length;
  console.log('='.repeat(66));
  console.log(`${results.length - failed}/${results.length} passed`);
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}