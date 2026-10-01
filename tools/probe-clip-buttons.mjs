// Do the three buttons on a SELECTED clip actually do anything?
//
// Link, Properties, Delete. They sit in the clip's top-right corner, so the
// first suspicion is the obvious one: the clip's own pointerdown handler starts
// a drag, and a drag and a click are the same gesture until the pointer moves.
// This clicks them the way a user would and reports what changed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'cb-'));
const PORT = 9800 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg() {
  for (const p of ['C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']) {
    try { if (require('node:fs').existsSync(p)) return p; } catch {}
  }
  try { return execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean); } catch { return null; }
}
const dir = join(userDir, 'f');
mkdirSync(dir, { recursive: true });
const clip = join(dir, 'c.mp4');
const ff = ffmpeg();
if (ff) spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:d=5:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
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

  // Add the clip, then select it so its corner buttons render.
  console.log('add:', await ev(`(() => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => /Add c/.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
    return !!b;
  })()`));
  await sleep(2000);
  console.log('select:', await ev(`(() => {
    const c = document.querySelector('[data-clip]');
    if (!c) return 'no clip';
    c.click();
    return 'ok';
  })()`));
  await sleep(1200);

  const before = await ev(`(() => {
    const c = document.querySelector('[data-clip]');
    const btns = [...c.querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect();
      return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
    });
    const cr = c.getBoundingClientRect();
    return JSON.stringify({ count: document.querySelectorAll('[data-clip]').length, clip: { w: Math.round(cr.width), h: Math.round(cr.height) }, btns });
  })()`);
  console.log('buttons on the selected clip:\n ', before);

  // Click each in turn and see whether the document changed.
  for (const label of ['Properties of', 'Remove ']) {
    const res = await ev(`(async () => {
      const tick = () => new Promise(r => requestAnimationFrame(r));
      const c = document.querySelector('[data-clip]');
      const b = [...c.querySelectorAll('button')].find(x => new RegExp('^${label}').test(x.getAttribute('aria-label') || ''));
      if (!b) return JSON.stringify({ found: false });
      const before = document.querySelectorAll('[data-clip]').length;
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      b.click();
      for (let i = 0; i < 6; i++) await tick();
      return JSON.stringify({
        found: true,
        hitTest: top ? top.tagName + '.' + (top.getAttribute('aria-label') || top.className || '').toString().slice(0, 30) : null,
        hitsButton: top === b,
        before,
        after: document.querySelectorAll('[data-clip]').length,
        dialog: !!document.querySelector('[role="dialog"]'),
        toast: (document.querySelector('[role="status"]') || {}).textContent || '',
      });
    })()`);
    console.log(` ${label}: ${res}`);
    if (label.startsWith('Remove')) break;
  }
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
