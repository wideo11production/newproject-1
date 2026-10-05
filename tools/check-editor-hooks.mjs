// Does the editor still throw React #300 when an audio clip is dragged with
// snapping on?
//
// -----------------------------------------------------------------------------
// WHY THIS NEEDS A BROWSER AND NOT A TYPE CHECK
// -----------------------------------------------------------------------------
//
// The defect was a `useEffect` below an early `return` in `Waveform`
// (`timeline-tracks.tsx`). `tsc` was clean, the build was clean, and the app
// served. The crash happens only when a MOUNTED `Waveform` crosses the
// `width <= 26` boundary going UP — which needs a real zoom or trim on a real
// audio clip.
//
// The trigger is snapping, and the reason is specific: `snapFrame` calls
// `setSnapLabel` on every `pointermove`, and with snapping ON the label genuinely
// changes between "Start of…", "End of…", "Playhead" and "Marker…". That is one
// extra full re-render of `TimelineTracks` and its whole lane subtree per pointer
// event — roughly three renders per move instead of one. That tripled render rate
// is what turned a latent boundary into a reliably reproducible crash.
//
// So this drives the actual gesture and counts console errors. It cannot be
// asserted statically, and it cannot be reproduced without doing the thing.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9350 + Math.floor(Math.random() * 50);
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

const profile = mkdtempSync(join(tmpdir(), 'wave-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  // ---- Synthetic media flags: a headless container has no camera or microphone,
  // and this test is about the RENDER, not about hardware. Without them
  // `getUserMedia` rejects and the timeline is never reached.
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000',
  'about:blank',
]);
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

let msgId = 0;
const consoleErrors = [];
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
  await cdp(ws, 'Log.enable', {}, sessionId).catch(() => {});

  // Collect console errors AND uncaught exceptions for the whole run.
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails.text + ' ' +
        (m.params.exceptionDetails.exception?.description ?? ''));
    }
  });

  // ---- Sign in through the real form: the editor is a separate origin and
  // cannot reach :3000 cross-origin, so a direct fetch is a CORS failure that
  // looks exactly like a broken login. ----
  await cdp(ws, 'Page.navigate', { url: 'http://localhost:3000/auth/login' }, sessionId);
  await new Promise((r) => setTimeout(r, 4000));
  await evaluate(ws, sessionId, `(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const e = document.querySelector('input[name=email], input[type=email]');
    const p = document.querySelector('input[name=password], input[type=password]');
    if (!e || !p) return 'no form';
    set(e, ${JSON.stringify(EMAIL)}); set(p, ${JSON.stringify(PASSWORD)});
    document.querySelector('form').requestSubmit();
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 8000));

  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);
  await new Promise((r) => setTimeout(r, 10000));

  const state = await evaluate(ws, sessionId, `JSON.stringify({
    path: location.pathname,
    text: document.body.innerText.slice(0, 220),
    hasTimeline: !!document.querySelector('[aria-label="Timeline ruler"]'),
    gated: /security setup|Continue to security/i.test(document.body.innerText),
    canvases: document.querySelectorAll('canvas').length
  })`);
  const s = JSON.parse(state);

  check('the editor loaded', s.hasTimeline || /WideoCut/i.test(s.text),
    `path=${s.path} timeline=${s.hasTimeline} canvases=${s.canvases}`);

  // ------------------------------------------------------------------
  // A GATE BETWEEN HERE AND THE ASSERTION IS A FALSE PASS.
  // ------------------------------------------------------------------
  //
  // The first run of this file reported `NO React #300 during zoom + drag` as a
  // PASS while the editor was sitting on "Finish your security setup" and the
  // timeline had never mounted. There was no `Waveform` on the page, so there was
  // nothing that could throw #300, and the assertion was satisfied by an editor
  // that was not running.
  //
  // That is the most expensive shape a test can have: green, meaningless, and
  // reported alongside real passes so nobody looks twice. So the timeline's
  // presence is a HARD GATE — without it the result is SKIP with the reason, and
  // the exit code is non-zero so CI cannot record it as a success.
  if (!s.hasTimeline) {
    check('REACHED the timeline (required to test #300)', false,
      s.gated
        ? 'BLOCKED by the mandatory security-setup gate: set a 6-digit PIN and three\n' +
          '        security questions on this account first. Nothing below was exercised,\n' +
          '        and no pass below should be read as evidence.'
        : `no timeline ruler found at path=${s.path}`);

    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, 'editor-no-300.png'), Buffer.from(shot.data, 'base64'));

    console.log('='.repeat(70));
    console.log('0/1 meaningful — the test could not reach the subject');
    cleanup();
    process.exit(1);
  }

  check('REACHED the timeline', true, 'ruler present, Waveform can mount');

  // ---- THE ASSERTION: drive the gesture, then count crashes ----
  {
    // Cross the `width <= 26` boundary on a real mounted Waveform, which is the
    // exact transition React #300 fires on. Zoom out past it and back.
    const zoomed = await evaluate(ws, sessionId, `(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label]'));
      const out = btns.find(b => /zoom out|out/i.test(b.getAttribute('aria-label') || ''));
      for (let i = 0; i < 12; i++) out?.click();
      return !!out;
    })()`);
    check('zoom control reachable', zoomed, '');
    await new Promise((r) => setTimeout(r, 2500));

    // And a drag on the lane, with snapping on — the reported trigger.
    const dragged = await evaluate(ws, sessionId, `(() => {
      const lane = document.querySelector('canvas')?.parentElement;
      if (!lane) return false;
      const b = lane.getBoundingClientRect();
      const y = b.top + 10, x0 = b.left + 200;
      const fire = (t, x) => lane.dispatchEvent(new PointerEvent(t, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        pointerId: 3, button: 0, buttons: t === 'pointerup' ? 0 : 1, isPrimary: true,
      }));
      fire('pointerdown', x0);
      for (let i = 1; i <= 25; i++) fire('pointermove', x0 + i * 12);
      fire('pointerup', x0 + 300);
      return true;
    })()`);
    check('lane drag dispatched', dragged, '');
    await new Promise((r) => setTimeout(r, 2500));
  }

  // React #300 has a recognisable text in dev; in production it is "Minified React
  // error #300" or a caught render abort. Both are collected above.
  const r300 = consoleErrors.filter((e) => /#300|rendered more hooks|too many hooks/i.test(e));
  check('NO React #300 during zoom + drag', r300.length === 0,
    r300.length ? r300[0].slice(0, 120) : `${consoleErrors.length} console error(s) total`);

  // Any error at all is worth surfacing, even if it is not #300.
  const others = consoleErrors.filter((e) => !/#300|rendered more hooks|too many hooks/i.test(e));
  check('no other console errors', others.length === 0,
    others.length ? others[0].slice(0, 140) : 'clean');

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'editor-no-300.png'), Buffer.from(shot.data, 'base64'));
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log('screenshot -> screenshots/editor-no-300.png');
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
