#!/usr/bin/env node
// ============================================================================
// END-TO-END: one project, every feature, in one run
// ============================================================================
//
// The main suite (check-video-editor.mjs) tests features in ISOLATION - trim on
// an empty timeline, a roll on two clips, a transition on a pair. This one
// builds a REAL project the way a person would, then goes back through the
// timeline and uses what it built.
//
// That is a different question and it catches a different class of bug: an
// operation that works alone and fights the others. Clip stacking only appears
// once clips overlap. Snapping only misbehaves once there is something to snap
// to. Persistence only breaks once a project has state worth losing.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'e2e-'));
const PORT = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures: three real clips, each a different colour and a different tone
function ffmpeg() {
  try { if (require('node:fs').existsSync('C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe')) return 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'; } catch {}
  try { return execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean); } catch { return null; }
}
const dir = join(userDir, 'f');
mkdirSync(dir, { recursive: true });
const ff = ffmpeg();
const clips = ['red', 'blue', 'green'];
for (const c of clips) {
  const out = join(dir, `${c}.mp4`);
  if (ff) {
    spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${c}:s=640x360:d=4:r=30`,
      '-f', 'lavfi', '-i', `sine=frequency=${c === 'red' ? 440 : c === 'blue' ? 660 : 880}:duration=4:sample_rate=44100`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { stdio: 'ignore' });
  }
}
const files = clips.map((c) => join(dir, `${c}.mp4`));

let ws, sid;
const results = [];
const j = (v) => {
  try { return JSON.parse(String(v)); } catch { return {}; }
};
const check = (name, pass, detail) => {
  results.push({ name, pass: Boolean(pass) });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

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

  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return JSON.stringify({ __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
    return r.result.value;
  };
  /** A gesture helper: runs in the page, waits frames, returns JSON. */
  const g = (body) => ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    ${body}
    for (let i = 0; i < 6; i++) await tick();
    return JSON.stringify(__out);
  })()`);

  // ---- 1. Import three real clips -------------------------------------
  {
    const { root } = await cdp('DOM.getDocument', {}, sid);
    const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
    await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files }, sid);
    await sleep(7000);
  }
  const imported = await g(`__out = { tiles: document.querySelectorAll('li').length };`);
  check('three real clips imported into the gallery', j(imported).tiles === 3, j(imported));

  // ---- 2. Build a timeline: red, blue, green -----------------------------
  //
  // `End` between each clip. Every clip was landing at frame 0 before this, so
  // the three of them were STACKED on top of each other rather than laid end to
  // end - and "two adjacent clips", which the roll and the transition both
  // need, did not exist to be tested. `End` puts the playhead at the project
  // duration, which is exactly the end of the last clip, so each new one starts
  // where the previous finished.
  for (const name of clips) {
    await g(`(() => {
      const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => new RegExp('Add ${name}\\\\.mp4').test(x.getAttribute('aria-label') || ''));
      if (b) b.click();
    })();`);
    await sleep(1600);
    await g(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));`);
    await sleep(500);
  }
  let built = await g(`__out = { clips: document.querySelectorAll('[data-clip]').length };`);
  check('all three clips are on the timeline', j(built).clips === 3, j(built));

  // ---- 3. Align two clips and weld them ---------------------------------
  const rolled = await g(`
    const c = document.querySelectorAll('[data-clip]');
    const a = c[0], b = c[1];
    if (!a || !b) { __out = { error: 'need two clips' }; return; }
    a.click(); await tick();
    const h = a.querySelector('[aria-label^="Trim end"]');
    const hb = h.getBoundingClientRect();
    const targetX = b.getBoundingClientRect().left;
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: hb.top + hb.height / 2, pointerId: 21, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(hb.right - 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(targetX - 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(targetX - 2)));
    __out = { trimmed: true };
  `);
  await sleep(800);
  const adjacency = await g(`
    const c = [...document.querySelectorAll('[data-clip]')];
    let welded = 0;
    for (const x of c) {
      const end = Number(x.getAttribute('data-frames-start')) + Number(x.getAttribute('data-frames-length'));
      if (c.some(y => y !== x && y.parentElement === x.parentElement && Number(y.getAttribute('data-frames-start')) === end)) welded++;
    }
    __out = { welded, handles: document.querySelectorAll('[aria-label^="Roll the cut"]').length };
  `);
  check('two clips weld together and a roll handle appears', j(adjacency).handles >= 1, j(adjacency));

  const rollRes = await g(`
    const before = [...document.querySelectorAll('[data-clip]')].map(c => Number(c.getAttribute('data-frames-length')));
    const h = document.querySelector('[aria-label^="Roll the cut"]');
    if (!h) { __out = { error: 'no handle' }; return; }
    const hb = h.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: hb.top + hb.height / 2, pointerId: 22, isPrimary: true, button: 0 });
    const cx = hb.left + hb.width / 2;
    h.dispatchEvent(new PointerEvent('pointerdown', o(cx)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(cx + 24)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(cx + 24)));
    const after = [...document.querySelectorAll('[data-clip]')].map(c => Number(c.getAttribute('data-frames-length')));
    __out = { before, after };
  `);
  const rr = j(rollRes);
  // The roll happens on the WELDED pair, not on the first two clips - so the
  // assertion has to find WHICH pair moved rather than assuming the first one.
  // Asserting on indices 0 and 1 tested nothing: the numbers are correct and
  // the pair is the wrong one.
  const grewAt = Array.isArray(rr.after) ? rr.after.findIndex((v, i) => v > (rr.before[i] ?? 0)) : -1;
  const pairOk =
    Array.isArray(rr.before) &&
    Array.isArray(rr.after) &&
    rr.after.some((v, i) => v > rr.before[i]) &&
    rr.after.some((v, i) => v < rr.before[i]) &&
    rr.before
      .map((v, i) => [v, rr.after[i]])
      .every(([a, b]) => a === b || Math.abs(a - b) < 60);
  const totalHeld = Array.isArray(rr.before) && Array.isArray(rr.after)
    ? rr.before.reduce((x, y) => x + y, 0) === rr.after.reduce((x, y) => x + y, 0)
    : false;
  check(
    'roll moves the cut: one clip grows, the next shrinks, the total is held',
    pairOk && totalHeld && grewAt >= 0,
    rr
  );

  // ---- 4. A transition between the welded pair -------------------------
  const trans = await g(`
    const c = [...document.querySelectorAll('[data-clip]')];
    let pair = null;
    for (const x of c) {
      const end = Number(x.getAttribute('data-frames-start')) + Number(x.getAttribute('data-frames-length'));
      const y = c.find(z => z !== x && z.parentElement === x.parentElement && Number(z.getAttribute('data-frames-start')) === end);
      if (y) { pair = [x, y]; break; }
    }
    if (!pair) { __out = { error: 'no welded pair' }; return; }
    pair[0].click(); await tick();
    [...document.querySelectorAll('nav[aria-label="Editor modes"] button')].find(b => /^Transitions/.test(b.getAttribute('aria-label') || ''))?.click();
    for (let i = 0; i < 4; i++) await tick();
    const tile = [...document.querySelectorAll('button')].find(b => /^Crossfade/.test(b.getAttribute('aria-label') || ''));
    if (tile) tile.click();
    for (let i = 0; i < 4; i++) await tick();
    __out = { badges: document.querySelectorAll('[data-transition]').length };
  `);
  check('a transition is added on the welded pair', j(trans).badges >= 1, j(trans));

  // ---- 5. A title and a second video lane for an overlay ---------------
  const extra = await g(`
    [...document.querySelectorAll('nav[aria-label="Editor modes"] button')].find(b => /^Titles/.test(b.getAttribute('aria-label') || ''))?.click();
    for (let i = 0; i < 4; i++) await tick();
    const before = document.querySelectorAll('[data-clip]').length;
    [...document.querySelectorAll('button')].find(b => /Lower third/.test(b.textContent || ''))?.click();
    for (let i = 0; i < 4; i++) await tick();
    [...document.querySelectorAll('nav[aria-label="Editor modes"] button')].find(b => /^Import/.test(b.getAttribute('aria-label') || ''))?.click();
    document.querySelector('[aria-label="Add a track"]')?.click();
    for (let i = 0; i < 3; i++) await tick();
    [...document.querySelectorAll('button')].find(b => /^Video track$/.test(b.textContent.trim()))?.click();
    for (let i = 0; i < 4; i++) await tick();
    __out = { clips: document.querySelectorAll('[data-clip]').length, added: document.querySelectorAll('[data-clip]').length - before, lanes: document.querySelectorAll('[data-track]').length };
  `);
  check('a title is added and a second video lane exists', j(extra).added === 1 && j(extra).lanes >= 4, j(extra));

  // ---- 6. Context menu, then attach/detach ------------------------------
  const menu = await g(`
    const clip = document.querySelector('[data-clip]');
    const r = clip.getBoundingClientRect();
    clip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 20 }));
    for (let i = 0; i < 4; i++) await tick();
    const m = document.querySelector('[role="menu"][aria-label="Timeline actions"]');
    __out = { open: !!m, items: m ? [...m.querySelectorAll('[role="menuitem"]')].map(b => b.textContent.trim()) : [] };
  `);
  check('right-click opens the timeline menu with the full action list',
    j(menu).open && ['Cut', 'Copy', 'Attach', 'Mute this clip'].every((x) => (j(menu).items || []).some((i) => i.startsWith(x))),
    { items: j(menu).items });

  // ---- 7. Filmstrip ------------------------------------------------------
  const strip = await g(`
    const best = { imgs: 0 };
    for (let i = 0; i < 20; i++) {
      for (const c of document.querySelectorAll('[data-clip]')) {
        const n = c.querySelectorAll('img').length;
        if (n > best.imgs) best.imgs = n;
      }
      if (best.imgs >= 2) break;
      await tick();
      await new Promise(r => setTimeout(r, 250));
    }
    __out = best;
  `);
  check('video clips carry a real filmstrip', j(strip).imgs >= 2, j(strip));

  // ---- 8. Audio actually reaches the output ------------------------------
  const audio = await g(`
    // Park on a clip first: pressing play over a gap plays nothing, and "no
    // sound" would then be the correct answer rather than a bug.
    const clip = document.querySelector('[data-clip]');
    const start = Number(clip.getAttribute('data-frames-start'));
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const rb = ruler.getBoundingClientRect();
    const pxf = Number(JSON.parse(localStorage.getItem('${''}wideo11.video-editor.settings.v1') || '{}').pxPerFrame) || 3;
    const o = { bubbles: true, cancelable: true, clientX: rb.left + (start + 4) * pxf, clientY: rb.top + 6, pointerId: 25, isPrimary: true, button: 0 };
    ruler.dispatchEvent(new PointerEvent('pointerdown', o));
    ruler.dispatchEvent(new PointerEvent('pointerup', o));
    for (let i = 0; i < 4; i++) await tick();
    document.querySelector('[aria-label="Play"]')?.click();
    for (let i = 0; i < 4; i++) await tick();
    let peak = 0;
    for (let i = 0; i < 80; i++) {
      const l = window.__veLevel ? window.__veLevel() : -1;
      if (l > peak) peak = l;
      await tick();
    }
    __out = { peak: Math.round(peak * 1000) / 1000, meter: !!document.querySelector('[role="meter"]'), playing: !!document.querySelector('[aria-label="Pause"]') };
  `);
  check('the voice meter is present and audio is measured at the output',
    j(audio).meter === true && j(audio).peak > 0.02, j(audio));
  await g(`document.querySelector('[aria-label="Pause"]')?.click();`);

  // ---- 9. Play from the start -------------------------------------------
  const playFromStart = await g(`
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const rb = ruler.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: rb.top + 6, pointerId: 26, isPrimary: true, button: 0 });
    ruler.dispatchEvent(new PointerEvent('pointerdown', o(rb.left + 2)));
    ruler.dispatchEvent(new PointerEvent('pointerup', o(rb.left + 2)));
    for (let i = 0; i < 3; i++) await tick();
    const atStart = Number(ruler.getAttribute('aria-valuenow'));
    document.querySelector('[aria-label="Play"]')?.click();
    for (let i = 0; i < 20; i++) await tick();
    const during = Number(ruler.getAttribute('aria-valuenow'));
    document.querySelector('[aria-label="Pause"]')?.click();
    __out = { atStart, during };
  `);
  check('play from the start begins at the start', j(playFromStart).atStart <= 1 && j(playFromStart).during > j(playFromStart).atStart, j(playFromStart));

  // ---- 10. Save, reload, and confirm the project survived ----------------
  const before = await g(`__out = {
    clips: document.querySelectorAll('[data-clip]').length,
    transitions: document.querySelectorAll('[data-transition]').length,
    lanes: document.querySelectorAll('[data-track]').length,
  };`);
  await g(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));`);
  await sleep(3000);

  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(9000);
  await ev(`(async () => {
    const t = () => new Promise(r => requestAnimationFrame(r));
    [...document.querySelectorAll('nav[aria-label="Editor modes"] button')].find(b => /^Import/.test(b.getAttribute('aria-label') || ''))?.click();
    for (let i = 0; i < 4; i++) await t();
    return true;
  })()`);
  await sleep(1500);

  const after = await g(`__out = {
    clips: document.querySelectorAll('[data-clip]').length,
    transitions: document.querySelectorAll('[data-transition]').length,
    lanes: document.querySelectorAll('[data-track]').length,
    footer: (document.body.innerText.match(/(\\d+) clips/) || [null, '0'])[1],
  };`);
  check(
    'the whole project survives a browser refresh',
    j(after).clips === j(before).clips && j(after).transitions === j(before).transitions && j(after).lanes === j(before).lanes,
    { before: j(before), after: j(after) }
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} end-to-end checks passed`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('probe failed:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}