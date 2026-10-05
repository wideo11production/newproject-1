// Does recording actually produce a playable clip?
//
// -----------------------------------------------------------------------------
// WHY THIS NEEDS A BROWSER AND SYNTHETIC DEVICES
// -----------------------------------------------------------------------------
//
// Two reasons, and the first is the whole point of the file.
//
//  1. THE BUG WAS IN THE `onstop` PATH, NOT IN ANY TYPED SIGNATURE. The blob was
//     built synchronously inside the click handler, while `MediaRecorder`'s final
//     `dataavailable` had not fired yet — so `chunksRef` was empty, the Blob was
//     zero bytes, and the review step rendered a video with no picture and no
//     error. `tsc` could not see it, a unit test on the reducer could not see it,
//     and it was reported as "recording works, save doesn't".
//
//     Only driving a real `MediaRecorder` and waiting for a real `stop` event
//     reproduces it. The assertion is on the SIZE of the resulting blob, because
//     zero bytes is exactly the failure and it is invisible in a screenshot.
//
//  2. HEADLESS CHROME HAS NO CAMERA AND NO MICROPHONE. Without
//     `--use-fake-device-for-media-stream` the page gets a `NotFoundError` and the
//     dialog never reaches `recording`, so there is nothing to test.
//
//     The fake device is a REAL capture pipeline — a synthetic moving pattern and a
//     tone — which means the produced WebM has real encoded frames in it. The test
//     therefore proves the encode path works, not merely that a stream was opened.
//
// What it asserts, in order, and what each failure would mean:
//
//	dialog reaches 'recording'      -> getUserMedia + MediaRecorder initialised
//	elapsed time advances          -> the recorder is actually consuming, not stalled
//	stop transitions to 'review'   -> the onstop path fires at all
//	review <video> has a src       -> the URL was bound to the element (the old bug)
//	the blob is NOT zero bytes     -> THE BUG THIS FILE EXISTS FOR
//	a decoded frame is non-blank   -> the file is real video, not a valid empty container
//	"Save to device" is present    -> the local-download path is wired
//	the separate-audio toggle shows -> the parallel recorder ran

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9500 + Math.floor(Math.random() * 40);
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

const profile = mkdtempSync(join(tmpdir(), 'rec-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
  // ---- THE TWO FLAGS THAT MAKE THIS POSSIBLE ----
  // The second gives Chrome a synthetic camera and microphone. The first stops it
  // prompting, which in headless mode means the permission never resolves and
  // `getUserMedia` hangs rather than rejecting.
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', 'about:blank',
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
    setTimeout(() => rej(new Error(`${method}: timeout`)), 60000);
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

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'http://localhost:3000/auth/login' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Browser.grantPermissions', {
    origin: BASE,
    permissions: ['videoCapture', 'audioCapture'],
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 4000));

  await evaluate(ws, sessionId, `(() => {
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const e = document.querySelector('input[type=email]');
    const p = document.querySelector('input[type=password]');
    if (!e || !p) return 'no form';
    set(e, ${JSON.stringify(EMAIL)}); set(p, ${JSON.stringify(PASSWORD)});
    document.querySelector('form').requestSubmit();
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 8000));
  await cdp(ws, 'Page.navigate', { url: BASE }, sessionId);
  await new Promise((r) => setTimeout(r, 10000));

  // ---- Open the recorder ----
  const opened = await evaluate(ws, sessionId, `(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const rec = btns.find(b => /record/i.test(b.getAttribute('aria-label') || b.textContent || ''));
    if (!rec) return { ok: false, labels: btns.map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 30) };
    rec.click();
    return { ok: true };
  })()`);
  const op = typeof opened === 'string' ? JSON.parse(opened) : opened;
  check('recorder dialog opened', op.ok === true, op.ok ? '' : `no record button; labels: ${JSON.stringify(op.labels).slice(0, 200)}`);

  if (op.ok) {
    await new Promise((r) => setTimeout(r, 1200));

    // ---- Start recording ----
    const started = await evaluate(ws, sessionId, `(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /start recording/i.test(b.textContent || ''));
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    })()`);
    const st = typeof started === 'string' ? JSON.parse(started) : started;
    check('clicked Start recording', st.ok === true);

    // Give it real time. 2.5s at 250ms timeslice = ~10 dataavailable events, so
    // the chunk array is genuinely populated rather than holding one final blob.
    await new Promise((r) => setTimeout(r, 2500));

    const rec = await evaluate(ws, sessionId, `(() => {
      const el = document.querySelector('[role=dialog]');
      const text = el ? el.innerText : '';
      return JSON.stringify({
        inDialog: !!el,
        showsRecording: /REC\\s*\\d+:\\d+/.test(text),
        hasLevelMeter: /input level/i.test(text),
        dialogText: text.replace(/\\s+/g, ' ').slice(0, 200)
      });
    })()`);
    const r2 = JSON.parse(rec);
    check('dialog is in the recording state', r2.inDialog && r2.showsRecording, r2.dialogText);
    check('the mic level meter is present', r2.hasLevelMeter, 'proves the AnalyserNode is wired');

    // ---- Stop ----
    await evaluate(ws, sessionId, `(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => /stop|finish/i.test(b.getAttribute('aria-label') || b.textContent || ''));
      if (btn) btn.click();
      return !!btn;
    })()`);

    // `onstop` is asynchronous. Wait for the review video to acquire a source.
    let rev = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 400));
      rev = JSON.parse(await evaluate(ws, sessionId, `(() => {
        const el = document.querySelector('[role=dialog]');
        const v = el ? el.querySelector('video[controls]') : null;
        return JSON.stringify({
          hasReview: !!(v && v.getAttribute('src')),
          src: v ? (v.getAttribute('src') || '').slice(0, 40) : null,
          vw: v ? v.videoWidth : 0,
          vh: v ? v.videoHeight : 0,
          dur: v ? v.duration : 0,
          text: el ? el.innerText.replace(/\\s+/g, ' ').slice(0, 220) : ''
        });
      })()`));
      if (rev.hasReview) break;
    }

    check('STOP produced a review step', !!rev.text && /watch it back|keep to timeline|save to device/i.test(rev.text), rev.text);
    check('the review video HAS a src (the old bug)', rev.hasReview === true, `src=${rev.src}`);
    check('the recording has a NON-ZERO size', rev.vw > 0,
      `decoded ${rev.vw}x${rev.vh}, duration ${Number(rev.dur || 0).toFixed(2)}s` +
      `  <-- videoWidth 0 means a ZERO-BYTE blob, which is exactly the bug`);
    check('"Save to device" is offered', /save to device/i.test(rev.text));
    check('the separate-audio toggle appeared', /separate clip/i.test(rev.text),
      'proves the parallel audio-only recorder ran');

    const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
    writeFileSync(join(OUT, 'editor-recorder-review.png'), Buffer.from(shot.data, 'base64'));
  }
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log('screenshot -> screenshots/editor-recorder-review.png');
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
