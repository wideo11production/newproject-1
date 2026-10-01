// Does audio ACTUALLY come out, or only look like it does?
//
// "The editor looks right but there is no sound" has four causes that are
// indistinguishable from the outside: the AudioContext is suspended, nothing
// is connected to the destination, the gain is zero, or the file has no audio
// track at all. This drives a real clip with a real tone through the real graph
// and measures the OUTPUT with an AnalyserNode, so the answer is a number and
// not an opinion.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { spawnSync, execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'au-'));
const PORT = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg() {
  for (const p of ['C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']) {
    try { if (require('node:fs').existsSync(p)) return p; } catch {}
  }
  try { return execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean); } catch { return null; }
}

const dir = join(userDir, 'f');
mkdirSync(dir, { recursive: true });
// A clip with a 440Hz tone AND video, so one file exercises both paths.
const av = join(dir, 'tone.mp4');
const toneOnly = join(dir, 'tone.wav');
const ff = ffmpeg();
if (ff) {
  spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=6:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6:sample_rate=44100', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', av], { stdio: 'ignore' });
  spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4:sample_rate=44100', toneOnly], { stdio: 'ignore' });
} else {
  writeFileSync(av, Buffer.alloc(1024));
  writeFileSync(toneOnly, Buffer.alloc(1024));
}

let ws, sid;
try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { u = (await r.json()).webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new globalThis.WebSocket(u);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = (m, p = {}, s) => new Promise((rs, rj) => {
    const id = Math.floor(Math.random() * 1e9);
    const h = (e) => { const x = JSON.parse(e.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rj(new Error(x.error.message)) : rs(x.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  await cdp('DOM.enable', {}, sid);
  await signIn(cdp, sid, URL);
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(7000);

  const { root } = await cdp('DOM.getDocument', {}, sid);
  const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
  await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [toneOnly, av] }, sid);
  await sleep(7000);

  const ev = async (e) => {
    const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // Add the WAV to an AUDIO lane - that is the path a user takes for sound.
  await ev(`(() => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => /Add tone/.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
    return !!b;
  })()`);
  await sleep(2500);

  // Move the playhead ONTO the clip first.
  //
  // Pressing Play at frame 0 plays NOTHING when the first clip starts at frame
  // 134, and "no sound" is then the correct answer - which is exactly the sort
  // of false alarm this probe exists to avoid making.
  const seeked = await ev(`(() => {
    const clip = document.querySelector('[data-clip]');
    if (!clip) return 'no clip';
    const start = Number(clip.getAttribute('data-frames-start'));
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const rb = ruler.getBoundingClientRect();
    const s = JSON.parse(localStorage.getItem('wideo11.video-editor.settings.v1') || '{}');
    const pxf = Number(s.pxPerFrame) || 3;
    const o = { bubbles: true, cancelable: true, clientX: rb.left + (start + 5) * pxf, clientY: rb.top + 6, pointerId: 95, isPrimary: true, button: 0 };
    ruler.dispatchEvent(new PointerEvent('pointerdown', o));
    ruler.dispatchEvent(new PointerEvent('pointerup', o));
    return String(start);
  })()`);
  console.log('playhead moved to frame', seeked);
  await sleep(1200);

  // A user gesture, because browsers refuse to start audio without one.
  const clicked = await ev(`(() => {
    const p = document.querySelector('[aria-label="Play"]');
    if (!p) return 'no play button';
    p.click();
    return 'clicked';
  })()`);
  console.log('play:', clicked);
  await sleep(2000);

  const report = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    let peak = 0, samples = 0, sum = 0;
    for (let i = 0; i < 90; i++) {
      const lvl = window.__veLevel ? window.__veLevel() : -1;
      if (lvl >= 0) { peak = Math.max(peak, lvl); sum += lvl; samples++; }
      await tick();
    }
    const el = document.querySelector('[aria-label="Pause"]');
    return JSON.stringify({ peak: Math.round(peak * 1000) / 1000, avg: samples ? Math.round((sum / samples) * 1000) / 1000 : -1, samples, playing: !!el });
  })()`);
  await ev(`(() => { document.querySelector('[aria-label="Pause"]')?.click(); return true; })()`);

  const r = JSON.parse(report);
  const audible = r.peak > 0.02;
  console.log(`peak level ${r.peak}  avg ${r.avg}  samples ${r.samples}  playing ${r.playing}`);
  console.log(audible ? 'PASS  audio reaches the output' : 'FAIL  no measurable audio at the destination');
  if (!audible) process.exitCode = 1;
} catch (e) {
  console.error('probe failed:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
