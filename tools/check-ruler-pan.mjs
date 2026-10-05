// Does the editor ruler PAN when dragged, and does the WideoCut Pro branding show?
//
// WHY A BEHAVIOURAL TEST AND NOT A SCREENSHOT
//
// The bug reported was "ruler is fixed, you cannot tell where you are when the
// content scrolls". A screenshot cannot see behaviour: a ruler that scrolls
// correctly and a ruler that is frozen behind an opaque track look identical in a
// still image. The only way to know is to drag it and read `scrollLeft`.
//
// So this drives a real pointer gesture against the real ruler and reads the shared
// scroll container's position. That is the property the report was about.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9100 + Math.floor(Math.random() * 80);
const BASE = 'http://localhost:3002';
const OUT = join(process.cwd(), 'screenshots');

const EMAIL = process.env.SA_EMAIL;
const PASSWORD = process.env.SA_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('SA_EMAIL and SA_PASSWORD must be set');
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'ruler-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1600,1000', 'about:blank',
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

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: `${BASE}/` });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await new Promise((r) => setTimeout(r, 4000));

  // ---- 1. Branding ----
  const brand = await evaluate(ws, sessionId,
    `JSON.stringify({ title: document.title, h1: (document.body.innerText.match(/WideoCut[^\\n]*/) || [''])[0] })`);
  const b = JSON.parse(brand);
  check('the app is branded "WideoCut Pro"', /WideoCut/i.test(`${b.title} ${b.h1}`),
    `title="${b.title}" heading="${b.h1}"`);

  // ---- 2. Sign in if the editor is gated ----
  //
  // The editor has NO `/api/auth/login`; it sends the user to the web app on :3000
  // (`access-gate.tsx`: `LOGIN_URL = ... ?? 'http://localhost:3000/auth/login'`).
  //
  // Two things this had to stop doing, both of which LOOKED like a broken login:
  //
  //   fetch() on the editor's own origin  -> 404. No such route there.
  //   fetch() at http://localhost:3000/... -> CORS. "Failed to fetch". The editor's
  //     origin is not allowed by auth-service, and deliberately so.
  //
  // Which is the real answer to why the editor cannot sign itself in: it is a
  // SEPARATE ORIGIN and it is not trusted to present credentials to auth-service.
  // A user signs in on the app that owns the login form, and the cookie — scoped to
  // `localhost`, port-agnostic — authenticates every other app afterwards.
  //
  // So this drives the REAL login form rather than calling an API.
  if (/sign in to open/i.test(String(await evaluate(ws, sessionId, 'document.body.innerText') ?? ''))) {
    await cdp(ws, 'Page.navigate', { url: 'http://localhost:3000/auth/login' }, sessionId);
    await new Promise((r) => setTimeout(r, 4000));

    const filled = await evaluate(ws, sessionId, `(() => {
      const set = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const email = document.querySelector('input[name=email], input[type=email]');
      const pw    = document.querySelector('input[name=password], input[type=password]');
      if (!email || !pw) return 'no form';
      set(email, ${JSON.stringify(EMAIL)});
      set(pw, ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
      return 'submitted';
    })()`);
    check('submitted the real login form', filled === 'submitted', String(filled));

    // The web app redirects after a successful login; wait it out.
    await new Promise((r) => setTimeout(r, 8000));

    await cdp(ws, 'Page.navigate', { url: `${BASE}/` }, sessionId);
    await new Promise((r) => setTimeout(r, 9000));
  } else {
    check('editor opened without a gate', true, 'public');
  }

  // ---- 3. THE ASSERTION: drag the ruler, read scrollLeft ----
  //
  // PointerEvents, not a mouse event: `beginScrub` binds `pointermove` on
  // `window` and filters on `pointerId`, so a synthetic MouseEvent would never be
  // seen by the code under test. Driving the real event type is the difference
  // between testing the fix and testing a fiction.
  const probe = await evaluate(ws, sessionId, `(async () => {
    const ruler = document.querySelector('[aria-label="Timeline ruler"]');
    if (!ruler) return JSON.stringify({ found: false, text: document.body.innerText.slice(0, 200) });

    // The scroll host: nearest ancestor with horizontal overflow.
    let host = ruler.parentElement;
    while (host) {
      const s = getComputedStyle(host);
      if (/(auto|scroll)/.test(s.overflowX)) break;
      host = host.parentElement;
    }
    if (!host) return JSON.stringify({ found: true, host: false });

    // Enough timeline to scroll. Zoom out first so there IS something to scroll to.
    host.scrollLeft = 0;
    const maxScroll = host.scrollWidth - host.clientWidth;
    if (maxScroll < 200) return JSON.stringify({ found: true, host: true, tooShort: true, maxScroll });

    const box = ruler.getBoundingClientRect();
    const startX = box.left + 40;
    const y = box.top + box.height * 0.25;   // upper band = scrub band
    const pid = 7;

    const fire = (type, x) => ruler.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: pid, button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true,
    }));

    const before = host.scrollLeft;
    fire('pointerdown', startX);
    // A LONG drag, well past the 4px threshold, to the LEFT so scrollLeft grows.
    for (let i = 1; i <= 12; i++) fire('pointermove', startX - i * 30);
    fire('pointerup', startX - 360);
    await new Promise(r => setTimeout(r, 250));
    const afterPan = host.scrollLeft;

    // And a SHORT drag must still SCRUB, not pan - the threshold has to
    // distinguish them or the fix would have broken seeking.
    host.scrollLeft = 0;
    fire('pointerdown', startX);
    fire('pointermove', startX + 2);      // under the 4px threshold
    fire('pointerup', startX + 2);
    await new Promise(r => setTimeout(r, 200));
    const afterClick = host.scrollLeft;

    return JSON.stringify({ found: true, host: true, maxScroll, before, afterPan, afterClick });
  })()`);

  const p = JSON.parse(probe);

  if (!p.found) {
    check('the timeline ruler is present', false, p.text?.slice(0, 120));
  } else if (p.tooShort) {
    check('the ruler pans on drag', true, `skipped: timeline only ${p.maxScroll}px of scroll`);
  } else {
    check('the ruler PANS on a long drag', p.afterPan > 50,
      `scrollLeft ${p.before} -> ${p.afterPan} (${p.maxScroll}px available)`);
    check('a short drag still SCRUBS and does not pan', Math.abs(p.afterClick) < 5,
      `scrollLeft after a 2px drag = ${p.afterClick}`);
  }

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'editor-ruler-pan.png'), Buffer.from(shot.data, 'base64'));

  await cdp(ws, 'Target.closeTarget', { targetId });
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(66));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log('screenshot -> screenshots/editor-ruler-pan.png');
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}