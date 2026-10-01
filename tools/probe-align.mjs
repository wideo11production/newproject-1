// Does the track header column line up EXACTLY with the lanes?
//
// "Roughly in the same place" is not a thing you can see and not a thing you
// should ship: if the header row for Audio 1 starts three pixels above the audio
// lane, every click on a lane's control lands on the wrong lane. So this
// measures the two rectangles and reports the gap, rather than asking whether
// the rows "look" aligned.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'al-'));
const PORT = 9850 + Math.floor(Math.random() * 40);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg() {
  try { if (require('node:fs').existsSync('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')) return 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'; } catch {}
  try { return execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean); } catch { return null; }
}
const dir = join(userDir, 'f');
mkdirSync(dir, { recursive: true });
const clip = join(dir, 'a.mp4');
const ff = ffmpeg();
if (ff) spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
else writeFileSync(clip, Buffer.alloc(1024));

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
  await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [clip] }, sid);
  await sleep(6000);

  const ev = async (e) => {
    const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return JSON.stringify({ __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
    return r.result.value;
  };

  const report = await ev(`(() => {
    const head = document.querySelector('[data-track-header]');
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const lanes = [...document.querySelectorAll('[data-track]')];
    // The header's first child is the column header row; the rest are the lanes,
    // with a trailing add-track row.
    const headRows = [...head.children].map(c => {
      const r = c.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    });
    const laneRects = lanes.map(l => {
      const r = l.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
    });
    const rb = ruler.getBoundingClientRect();
    return JSON.stringify({
      ruler: { top: Math.round(rb.top), h: Math.round(rb.height) },
      headRows, laneRects,
    });
  })()`);

  const r = JSON.parse(report);
  console.log('ruler    ', JSON.stringify(r.ruler));
  console.log('headRows ', JSON.stringify(r.headRows));
  console.log('lanes    ', JSON.stringify(r.laneRects));
  if (r.headRows.length && r.laneRects.length) {
    const gaps = r.laneRects.map((l, i) => {
      const h = r.headRows[i + 1];
      return h ? h.top - l.top : null;
    });
    console.log('gap per lane (header row top - lane top):', JSON.stringify(gaps));
  }
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
