#!/usr/bin/env node
// ============================================================================
// Branding + sponsor-slot probe for the video editor at :3002
// ============================================================================
//
// The main check suite (check-video-editor.mjs) covers the timeline, but
// nothing in it puts a MARK on the picture. This probe drives the real
// interface to answer one question: does a logo the user adds actually
// appear on the preview, survive an undo, and survive a refresh?
//
// Path exercised:
//   Branding mode -> sponsor file input -> media store registration ->
//   branding lane clip -> compositor paintBranding -> canvas pixels ->
//   undo/redo -> save -> reload -> IndexedDB media restore.
//
// The channel-logo path shares every step after the clip is created
// (same lane, same paintBranding), and its API was verified separately
// (401 without a session, 400 on a bad URL, 200 on a real PATCH).
//
// Usage:  node tools/probe-branding.mjs [url]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const userDir = mkdtempSync(join(tmpdir(), 'vebrand-'));
const PORT = 9700 + Math.floor(Math.random() * 80);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDir}`,
    '--no-sandbox',
    '--disable-gpu',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--window-size=1600,1000',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A magenta square, and a red clip. Red is what the timeline's own sample
// clip paints, so the corner is RED before the logo and MAGENTA after —
// the two cannot be confused, and an undo that works is visible in pixels.
function makeFixtures() {
  const dir = join(userDir, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const logo = join(dir, 'Sponsor Logo.png');
  const clip = join(dir, 'Sample Clip.mp4');
  let ffmpeg = null;
  for (const p of ['C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']) {
    if (existsSync(p)) { ffmpeg = p; break; }
  }
  if (!ffmpeg) {
    try {
      const out = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' });
      const first = out.split(/\r?\n/).find(Boolean);
      if (first && existsSync(first)) ffmpeg = first;
    } catch { /* not on PATH */ }
  }
  if (ffmpeg) {
    spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xFF00FF:s=64x64', '-frames:v', '1', logo], { stdio: 'ignore' });
    spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { stdio: 'ignore' });
  }
  if (!existsSync(logo)) {
    // 1x1 magenta PNG, written by hand. Small, but still a real PNG the
    // browser will decode and the compositor will draw.
    writeFileSync(logo, Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
      '0000000d4944415478da63fccf808f88ffcf0005050200a7a4c47c0000000049454e44ae426082',
      'hex'
    ));
  }
  return { logo, clip, real: existsSync(clip) && existsSync(logo) };
}

let ws;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
}
function j(value) {
  try { return JSON.parse(String(value)); } catch { return {}; }
}

try {
  const fx = makeFixtures();
  console.log(`fixtures: ${fx.real ? 'real media via ffmpeg' : '!! STUB - pixel assertions are weaker'}`);
  console.log(`logo: ${fx.logo}`);

  let u;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { u = (await r.json()).webSocketDebuggerUrl; break; }
    } catch { /* not up yet */ }
    await sleep(250);
  }
  ws = new globalThis.WebSocket(u);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  const cdp = (method, params = {}, session) =>
    new Promise((rs, rj) => {
      const id = Math.floor(Math.random() * 1e9);
      const h = (e) => {
        const x = JSON.parse(e.data);
        if (x.id === id) {
          ws.removeEventListener('message', h);
          x.error ? rj(new Error(x.error.message + ' :: ' + String(method))) : rs(x.result);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id, method, params, sessionId: session }));
    });

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  await cdp('DOM.enable', {}, sid);

  const logs = [];
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Log.entryAdded' && x.params?.entry?.level === 'error') logs.push(x.params.entry.text);
    if (x.method === 'Runtime.exceptionThrown') logs.push(String(x.params?.exceptionDetails?.exception?.description ?? 'exception'));
  });

  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return JSON.stringify({ __error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text });
    return r.result.value;
  };
  const json = async (expression) => j(await ev(expression));
  const gesture = (body) =>
    `(async () => {
      const tick = () => new Promise(r => requestAnimationFrame(r));
      ${body}
      await tick(); await tick(); await tick();
    })()`;

  await signIn(cdp, sid, URL);
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(7000);

  // === Import a red clip first ============================================
  // A real clip gives the preview something to paint, so the corner is
  // RED before the logo and MAGENTA after it. An empty project is black
  // either way, and "black changed to black" proves nothing.
  {
    const { root } = await cdp('DOM.getDocument', {}, sid);
    const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
    await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [fx.clip] }, sid);
  }
  await sleep(5000);
  // Importing alone puts nothing on the timeline: the tile's own
  // button drops it at the playhead.
  await ev(gesture(`
    const b = [...document.querySelectorAll('button[aria-pressed]')]
      .find(x => /^Add Sample Clip/.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
    return true;
  `));
  await sleep(2000);

  // Read the bottom-right cell of the preview, downscaled to 8x8.
  const corner = async (label) => json(gesture(`
    const c = document.querySelector('[role="img"] canvas');
    if (!c) return JSON.stringify({ error: 'no canvas' });
    const t = document.createElement('canvas'); t.width = 8; t.height = 8;
    t.getContext('2d').drawImage(c, 0, 0, 8, 8);
    const d = t.getContext('2d').getImageData(0, 0, 8, 8).data;
    const cell = (x, y) => { const i = (y * 8 + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    return JSON.stringify({ label: '${label}', corner: cell(7, 7), inner: cell(6, 7), topRight: cell(7, 0) });
  `));

  const base = await corner('baseline');
  check('preview paints the red sample clip (baseline is RED, not magenta)',
    base.corner && base.corner[0] > 150 && base.corner[1] < 80 && base.corner[2] < 80, base);

  // === Branding mode ======================================================
  await ev(gesture(`
    const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '').startsWith('Branding'));
    if (b) b.click();
    return true;
  `));
  await sleep(1500);

  const panel = await json(`(() => {
    const input = document.querySelector('input[type=file][aria-label="Choose a sponsor or second logo"]');
    return JSON.stringify({ panelOpen: !!input, hint: !!document.body.innerText.match(/sponsor/i) });
  })()`);
  check('branding panel open with the sponsor file input', panel.panelOpen, panel);

  // === Add the sponsor logo ===============================================
  {
    const { root } = await cdp('DOM.getDocument', {}, sid);
    const { nodeIds } = await cdp('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: 'input[type=file][aria-label="Choose a sponsor or second logo"]',
    }, sid);
    check('sponsor file input found in the DOM', nodeIds.length === 1, { nodeIds: nodeIds.length });
    if (nodeIds.length) {
      await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[0], files: [fx.logo] }, sid);
    }
  }
  // The toast dismisses itself after 3 seconds (video-editor.tsx), so it
  // is read at under a second - after the clip exists, before it is gone.
  await sleep(900);

  const added = await json(`(() => {
    const t = document.body.innerText;
    const lane = document.querySelector('[data-track-type="branding"]');
    return JSON.stringify({
      toast: (document.querySelector('[role="status"]') || {}).textContent || null,
      mentionsMark: /bottom-right mark/.test(t),
      brandingClips: lane ? lane.querySelectorAll('[data-clip]').length : -1,
      totalClips: document.querySelectorAll('[data-clip]').length,
    });
  })()`);
  check('toast says the mark was added bottom-right', /bottom-right mark/.test(added.toast || ''), added);
  check('branding lane holds exactly one clip', added.brandingClips === 1, added);

  // The compositor decodes the logo on its own schedule; give it a beat.
  await sleep(2000);

  // The logo sits INSIDE the corner cell (128px of the 160px cell, with
  // padding), so the cell is a red/magenta MIX. The blue channel rising
  // from 0 to well above 0 is the paint; demanding a pure magenta cell
  // would fail a correct, correctly-sized logo.
  const painted = await corner('after sponsor');
  check('the logo is PAINTED in the bottom-right corner (blue channel rises)',
    painted.corner && painted.corner[0] > 150 && painted.corner[2] > 60, painted);

  // How tall is the painted mark? A 64x64 logo at 10% of a 1280px frame
  // is 128px square. Scanning a column through it for magenta rows
  // measures the square - a logo drawn as a sliver, or not at its natural
  // size, counts fewer rows.
  const size = await json(gesture(`
    const c = document.querySelector('[role="img"] canvas');
    if (!c) return JSON.stringify({ error: 'no canvas' });
    const d = c.getContext('2d').getImageData(1200, 380, 1, 340).data;
    let rows = 0;
    for (let y = 0; y < 340; y++) {
      const i = y * 4;
      if (d[i] > 180 && d[i + 2] > 180 && d[i + 1] < 120) rows++;
    }
    return JSON.stringify({ magentaRows: rows });
  `));
  check('the mark is drawn at its natural size (~128px, not a sliver)', size.magentaRows >= 60, size);

  // === Undo / redo ========================================================
  await ev(gesture(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return true;`));
  await sleep(1500);
  const undone = await json(`(() => {
    const lane = document.querySelector('[data-track-type="branding"]');
    return JSON.stringify({ brandingClips: lane ? lane.querySelectorAll('[data-clip]').length : -1 });
  })()`);
  const cornerAfterUndo = await corner('after undo');
  check('undo removes the sponsor clip and the corner goes back to red',
    undone.brandingClips === 0 && cornerAfterUndo.corner && cornerAfterUndo.corner[0] > 150 && cornerAfterUndo.corner[2] < 40,
    { undone, cornerAfterUndo });

  await ev(gesture(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); return true;`));
  await sleep(1500);
  const redone = await json(`(() => {
    const lane = document.querySelector('[data-track-type="branding"]');
    return JSON.stringify({ brandingClips: lane ? lane.querySelectorAll('[data-clip]').length : -1 });
  })()`);
  const cornerAfterRedo = await corner('after redo');
  check('redo brings the mark back, painted again',
    redone.brandingClips === 1 && cornerAfterRedo.corner && cornerAfterRedo.corner[2] > 60,
    { redone, cornerAfterRedo });

  // === Persistence ========================================================
  await ev(gesture(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); return true;`));
  await sleep(2500);
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(8000);

  const restored = await json(`(() => {
    const lane = document.querySelector('[data-track-type="branding"]');
    return JSON.stringify({
      brandingClips: lane ? lane.querySelectorAll('[data-clip]').length : -1,
      totalClips: document.querySelectorAll('[data-clip]').length,
      binTiles: [...document.querySelectorAll('li')].map(li => li.innerText.split('\\n')[0]).filter(Boolean),
    });
  })()`);
  const cornerAfterReload = await corner('after reload');
  check('the sponsor mark survives a save + reload, painted from the restored bytes',
    restored.brandingClips === 1 && cornerAfterReload.corner && cornerAfterReload.corner[2] > 60,
    { restored, cornerAfterReload });

  // === Channels (informational) ===========================================
  const channels = await ev(`(async () => {
    try {
      const r = await fetch('/api/channels', { credentials: 'same-origin' });
      const body = await r.json();
      const list = Array.isArray(body) ? body : (body.channels || body.data || []);
      return JSON.stringify({ status: r.status, count: list.length, first: list[0] ? { id: list[0].id, handle: list[0].handle, hasLogo: Boolean(list[0].logo_url) } : null });
    } catch (e) { return JSON.stringify({ error: String(e) }); }
  })()`);
  console.log(`INFO  /api/channels from the signed-in editor: ${channels}`);

  check('no console errors for the whole run', logs.length === 0, { errors: logs.slice(0, 5) });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(`RESULT: ${failed.length ? 'FAIL' : 'PASS'}`);
} finally {
  try { chrome.kill(); } catch { /* already gone */ }
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* temp */ }
}
