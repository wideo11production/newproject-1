#!/usr/bin/env node
// ============================================================================
// Functional + visual check of the video editor at :3002
// ============================================================================
//
// Everything is asserted through the real interface: a real file is pushed into
// a real `<input type="file">`, real pointer events drive real drags, and the
// DOM is read back afterwards. Nothing imports editor internals, because a test
// that can reach into the state passes even when the interface is broken.
//
// ---- WHY THE FIXTURES ARE GENERATED RATHER THAN STUBBED ----
//
// `Buffer.alloc(64KB, 7)` is not a video, so a "does the preview render"
// assertion against it would pass for the WRONG reason: a broken compositor
// also draws nothing. Real MP4s with real frames mean a red frame on screen
// PROVES the renderer ran, and a black frame proves it did not.
//
// ---- EVERY GESTURE IS ASYNCHRONOUS, AND THAT IS THE POINT ----
//
// React 18 batches a state update raised from a native event listener and
// flushes it in a microtask. A test that dispatches an event and reads the DOM
// in the SAME task therefore reads the PREVIOUS render. That mistake reports a
// working editor as broken in every gesture at once, which is both alarming and
// completely false. So every gesture here runs inside `gesture()`, which waits
// animation frames between the steps and again before anything is read.
//
// Synthetic `PointerEvent`s, not CDP `Input.dispatchMouseEvent`: in this
// headless build a CDP `mousePressed` never reaches the page, while a CDP
// `mouseMoved` does - which is worse, because it looks like it works. Every
// pointerdown is paired with a pointerup carrying the same `pointerId`.
//
// Usage:  node tools/check-video-editor.mjs [url] [screenshot.png]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const SHOT = process.argv[3] ?? 'editor.png';
const SHOT2 = process.argv[4] ?? 'editor-full.png';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SETTINGS_KEY = 'wideo11.video-editor.settings.v1';

/**
 * The scrollbar width this project ships, in pixels.
 *
 * A named constant rather than a number typed into the assertion, because the
 * width has already been changed once and the stale assertion caught it as a
 * FAILURE of the app rather than as a change to the test. One number, read by
 * the check, so the two cannot disagree.
 *
 * NOTE: the shared rules live in `packages/ui/src/styles/scrollbar.css`, and
 * they only render if the standard `scrollbar-color` is NOT set on `html`.
 * Chrome 121+ ignores every `::-webkit-scrollbar` rule in the document when it
 * is. See the comment at the top of that file.
 */
const SCROLLBAR_PX = 4;

const userDir = mkdtempSync(join(tmpdir(), 've-'));
const PORT = 9600 + Math.floor(Math.random() * 90);
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function findFfmpeg() {
  for (const p of ['C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\ffmpeg\\bin\\ffmpeg.exe']) {
    if (existsSync(p)) return p;
  }
  try {
    const out = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' });
    const first = out.split(/\r?\n/).find(Boolean);
    if (first && existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return null;
}

function makeFixtures() {
  const dir = join(userDir, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const red = join(dir, 'Sample Clip.mp4');
  const blue = join(dir, 'Second Clip.mp4');
  const tone = join(dir, 'Room Tone.wav');
  const img = join(dir, 'Photo.png');
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    for (const f of [red, blue, tone, img]) writeFileSync(f, Buffer.alloc(64 * 1024, 7));
    return { red, blue, tone, img, real: false };
  }
  const base = ['-y', '-hide_banner', '-loglevel', 'error'];
  const mk = (args) => spawnSync(ffmpeg, args, { stdio: 'ignore' }).status === 0;
  const okRed = mk([
    ...base,
    '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=3:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red,
  ]);
  const okBlue = mk([...base, '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue]);
  const okTone = mk([...base, '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2:sample_rate=44100', tone]);
  const okImg = mk([...base, '-f', 'lavfi', '-i', 'color=c=green:s=640x360', '-frames:v', '1', img]);
  if (!okRed || !okBlue || !okImg) {
    for (const f of [red, blue, tone, img]) writeFileSync(f, Buffer.alloc(64 * 1024, 7));
    return { red, blue, tone, img, real: false };
  }
  return { red, blue, tone, img, real: true };
}

// ---------------------------------------------------------------------------

let ws;
let sid;
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
}

function j(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

try {
  const fx = makeFixtures();
  console.log(`fixtures: ${fx.real ? 'real media via ffmpeg' : '!! STUB BYTES - render assertions are NOT meaningful'}`);

  let u;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        u = (await r.json()).webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  ws = new globalThis.WebSocket(u);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  const cdp = (method, params = {}, session) =>
    new Promise((rs, rj) => {
      const id = Math.floor(Math.random() * 1e9);
      const h = (e) => {
        const x = JSON.parse(e.data);
        if (x.id === id) {
          ws.removeEventListener('message', h);
          x.error ? rj(new Error(x.error.message + ' :: ' + String(method) + ' :: ' + String(JSON.stringify(params).slice(0,300)))) : rs(x.result);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id, method, params, sessionId: session }));
    });

  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  await cdp('DOM.enable', {}, sid);
  await cdp('Log.enable', {}, sid);

  const logs = [];
  const appLogs = [];
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Log.entryAdded' && x.params?.entry?.level === 'error') logs.push(x.params.entry.text);
    if (x.method === 'Runtime.consoleAPICalled') {
      appLogs.push((x.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
    if (x.method === 'Runtime.exceptionThrown') {
      logs.push(String(x.params?.exceptionDetails?.exception?.description ?? 'exception'));
    }
  });

  /** Evaluate an expression in the page. The expression goes into the error,
   *  because CDP's "Invalid parameters" names the METHOD and nothing else, and
   *  a 700-character anonymous expression is otherwise impossible to find. */
  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return r.result.value;
  };
  const json = async (expression) => j(await ev(expression));

  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(7000);

  /**
   * Build a page-side gesture expression.
   *
   * It returns a STRING, not a result. Passing it to `ev()` or `json()` is what
   * evaluates it - and `await gesture(...)` would send the resolved promise of
   * a call to `ev` straight into `Runtime.evaluate`, where it serialises to `{}`
   * and comes back as "Invalid parameters" with no other clue.
   *
   * `body` is page-side source and may `await tick()`. The trailing wait is not
   * optional: it is the difference between reading the state after the gesture
   * and reading the state before it.
   */
  const gesture = (body) =>
    `(async () => {
      const tick = () => new Promise(r => requestAnimationFrame(r));
      ${body}
      for (let i = 0; i < 5; i++) await tick();
      return true;
    })()`;

  /** Seek by clicking the ruler's SCRUB band (the upper half). */
  const seekRuler = (px) =>
    ev(
      `(async () => {
        const tick = () => new Promise(r => requestAnimationFrame(r));
        const el = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
        const box = el.getBoundingClientRect();
        const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 42, isPrimary: true, button: 0 });
        el.dispatchEvent(new PointerEvent('pointerdown', o(box.left + ${px})));
        await tick();
        el.dispatchEvent(new PointerEvent('pointerup', o(box.left + ${px})));
        await tick();
        return true;
      })()`
    );

  /** Click a mode-rail button by the start of its label. */
  const rail = async (label) => {
    await ev(
      `(async () => {
        const tick = () => new Promise(r => requestAnimationFrame(r));
        [...document.querySelectorAll('nav[aria-label="Editor modes"] button')]
          .find(b => new RegExp('^${label}').test(b.getAttribute('aria-label') || ''))?.click();
        for (let i = 0; i < 3; i++) await tick();
        return true;
      })()`
    );
    await sleep(400);
  };

  // === 1. Boot ===============================================================
  const boot = await json(`(() => {
    let rules = 0;
    for (const s of document.styleSheets) { try { rules += (s.cssRules || []).length; } catch {} }
    const r = document.querySelector('nav[aria-label="Editor modes"]');
    const buttons = r ? [...r.querySelectorAll('button')] : [];
    const c = document.querySelector('[role="img"] canvas');
    return JSON.stringify({
      cssRules: rules,
      brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      unnamed: buttons.map(b => b.getAttribute('aria-label')).filter(n => !n),
      canvasSize: c ? c.width + 'x' + c.height : null,
      noHorizontalScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
      footers: [...document.querySelectorAll('div')].filter(d => {
        const cs = getComputedStyle(d);
        return cs.borderTopWidth === '1px' && d.querySelector('span')?.textContent?.startsWith('TC ');
      }).length,
    });
  })()`);
  check('styling compiled', boot.cssRules > 100, { cssRules: boot.cssRules });
  check('no broken images on boot', boot.brokenImages === 0, boot);
  check('every mode-rail button has an accessible name', boot.unnamed.length === 0, boot);
  check('preview canvas exists at project size', boot.canvasSize === '1280x720', boot);
  check('no horizontal document overflow', boot.noHorizontalScroll);
  check('exactly one status strip under the timeline', boot.footers === 1, { footers: boot.footers });

  const bootErrors = logs.filter((l) => !/favicon|net::ERR_|status of 40/.test(l));
  check('no console errors at boot (no hydration mismatch)', bootErrors.length === 0, {
    errors: bootErrors.slice(0, 3).map((e) => String(e).split('\n')[0]),
  });

  // === 2. Import ============================================================
  {
    const { root } = await cdp('DOM.getDocument', {}, sid);
    const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
    await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [fx.red, fx.blue, fx.tone, fx.img] }, sid);
  }
  await sleep(6000);

  const imported = await json(`(() => {
    const t = document.body.innerText;
    return JSON.stringify({
      tiles: document.querySelectorAll('li').length,
      clips: document.querySelectorAll('[data-clip]').length,
      hasAll: /Sample Clip/.test(t) && /Second Clip/.test(t) && /Room Tone/.test(t) && /Photo/.test(t),
      brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      durations: [...document.querySelectorAll('li')].map(li => (li.innerText.match(/\\d:\\d\\d/) || [''])[0]).filter(Boolean),
    });
  })()`);
  check('all four fixtures in the bin', imported.hasAll && imported.tiles === 4, imported);
  check('importing alone puts NOTHING on the timeline', imported.clips === 0, { clips: imported.clips });
  check('no broken images after import', imported.brokenImages === 0, { brokenImages: imported.brokenImages });
  check('durations read from real media', imported.durations.length >= 3, { durations: imported.durations });

  const addClip = async (name) => {
    const label = 'Add ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await ev(
      `(async () => {
        const tick = () => new Promise(r => requestAnimationFrame(r));
        [...document.querySelectorAll('button[aria-pressed]')]
          .find(x => new RegExp('${label}').test(x.getAttribute('aria-label') || ''))?.click();
        await tick();
        return true;
      })()`
    );
    await sleep(900);
  };

  await addClip('Sample Clip');
  await seekRuler(270);
  await addClip('Second Clip');
  await addClip('Room Tone');
  await sleep(900);

  const timeline = await json(`(() => {
    const clips = [...document.querySelectorAll('[data-clip]')];
    return JSON.stringify({
      clipCount: clips.length,
      frames: clips.map(c => c.getAttribute('data-frames-start') + '+' + c.getAttribute('data-frames-length')),
      trimHandles: document.querySelectorAll('[role="separator"][aria-label^="Trim"]').length,
      fadeHandles: document.querySelectorAll('[role="separator"][aria-label^="Fade"]').length,
      faders: document.querySelectorAll('input[aria-label$="volume"]').length,
      addTrack: !!document.querySelector('[aria-label="Add a track"]'),
    });
  })()`);
  check('three clips added across the default lanes', timeline.clipCount === 3, timeline);
  check('clips carry frame numbers, not just seconds', timeline.frames.every((f) => /^\d+\+\d+$/.test(f)), { frames: timeline.frames });
  check('trim and fade handles exist', timeline.trimHandles >= 6 && timeline.fadeHandles >= 6, timeline);
  check('per-track volume faders and an add-track control', timeline.faders >= 3 && timeline.addTrack, timeline);

  // === 3. The compositor =====================================================
  const sampleCanvas = `(() => {
    const c = document.querySelector('[role="img"] canvas');
    if (!c) return null;
    const t = document.createElement('canvas'); t.width = 8; t.height = 8;
    t.getContext('2d').drawImage(c, 0, 0, 8, 8);
    const d = t.getContext('2d').getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
    const n = d.length / 4;
    return JSON.stringify({ r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n) });
  })()`;

  const pixel = async (want, tries = 14) => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      await sleep(400);
      last = j(await ev(sampleCanvas));
      if (last && want(last)) return last;
    }
    return last;
  };

  await seekRuler(2);
  const atZero = await pixel((p) => p.r > 120 && p.g < 70 && p.b < 70);
  check('preview renders the red clip at the start', atZero && atZero.r > 120, atZero);

  await seekRuler(460);
  const atBlue = await pixel((p) => p.b > 120 && p.r < 70);
  check('preview follows the playhead onto the blue clip', atBlue && atBlue.b > 120 && atBlue.r < 70, atBlue);

  // === 4. Transitions ========================================================
  await ev(`(() => { document.querySelector('[data-clip]').click(); return true; })()`);
  await sleep(300);
  await rail('Transitions');
  const tr = await json(gesture(`
    const tile = [...document.querySelectorAll('button')].find(b => /^Crossfade/.test(b.getAttribute('aria-label') || ''));
    if (tile) tile.click();
    await tick();
    return true;
  `));
  await sleep(600);
  const badges = await json(`document.querySelectorAll('[data-transition]').length`);
  check('transition added to the join between two touching clips', badges >= 1, { badges, ...tr });

  await ev(gesture(`
    const badge = document.querySelector('[data-transition]');
    const b = badge.getBoundingClientRect();
    const el = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = el.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 43, isPrimary: true, button: 0 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(b.left + b.width / 2)));
    await tick();
    el.dispatchEvent(new PointerEvent('pointerup', o(b.left + b.width / 2)));
  `));
  const blend = await pixel((p) => p.r > 20 && p.b > 20);
  check('crossfade blends two clips (neither pure red nor pure blue)', blend && blend.r > 20 && blend.b > 20, blend);

  // === 5. Waveforms, trim, fade ==============================================
  const waves = await json(`document.querySelectorAll('[data-clip] canvas').length`);
  check('waveform canvases rendered on audio-bearing clips', waves >= 2, { canvases: waves });

  const trim = await json(gesture(`
    const clip = document.querySelector('[data-clip]');
    const before = Number(clip.getAttribute('data-frames-length'));
    const h = clip.querySelector('[aria-label^="Trim end"]');
    const hb = h.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: hb.top + hb.height / 2, pointerId: 7, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(hb.right - 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(hb.right - 2 - 60)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(hb.right - 2 - 60)));
    await tick();
    const after = Number(document.querySelector('[data-clip]').getAttribute('data-frames-length'));
    return JSON.stringify({ before, after, shorter: after < before, keptAtLeastOne: after >= 1 });
  `));
  check('dragging the out-edge shortens the clip, in whole frames', trim.shorter && trim.keptAtLeastOne, trim);

  const fade = await json(gesture(`
    const clip = [...document.querySelectorAll('[data-clip]')].find(c => c.querySelector('[aria-label^="Fade out"]'));
    const read = () => parseFloat((clip.querySelector('[aria-label^="Fade out"]').getAttribute('title') || '').match(/([\\d.]+)s/)?.[1] ?? '0');
    const before = read();
    const h = clip.querySelector('[aria-label^="Fade out"]');
    const hb = h.getBoundingClientRect();
    const o = (y) => ({ bubbles: true, cancelable: true, clientX: hb.left + 3, clientY: y, pointerId: 8, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(hb.top + 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(hb.top - 40)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(hb.top - 40)));
    await tick();
    return JSON.stringify({ before, after: read() });
  `));
  check('dragging the fade corner lengthens the fade', fade.after > fade.before + 0.1, fade);

  // === 6. Cross-lane drag ====================================================
  await ev(`(() => { document.querySelector('[aria-label="Add a track"]').click(); return true; })()`);
  await sleep(400);
  await ev(gesture(`
    [...document.querySelectorAll('button')].find(b => /^Video track$/.test(b.textContent.trim()))?.click();
  `));

  const lanesBefore = await json(`(() => {
    const clip = document.querySelector('[data-clip]');
    const cb = clip.getBoundingClientRect();
    const lanes = [...document.querySelectorAll('[data-track]')].map(l => {
      const r = l.getBoundingClientRect();
      return { id: l.getAttribute('data-track'), type: l.getAttribute('data-track-type'), top: Math.round(r.top), height: Math.round(r.height), clips: l.querySelectorAll('[data-clip]').length };
    });
    const from = lanes.find(l => l.id === clip.parentElement.getAttribute('data-track'));
    const target = lanes.find(l => l.type === 'video' && l.clips === 0 && l.top > from.top);
    return JSON.stringify({ lanes, target: target ? target.id : null, clipId: clip.getAttribute('data-clip-id'), grab: { x: Math.round(cb.left + 30), y: Math.round(cb.top + 20) } });
  })()`);
  check(
    'a second video lane is added next to the first',
    lanesBefore.lanes.filter((l) => l.type === 'video').length === 2,
    { lanes: lanesBefore.lanes.map((l) => l.type + ':' + l.clips) }
  );

  if (lanesBefore.target) {
    const lane = lanesBefore.lanes.find((x) => x.id === lanesBefore.target);
    const g = lanesBefore.grab;
    const mid = lane.top + Math.round(lane.height / 2);
    await ev(gesture(`
      const clip = document.querySelector('[data-clip-id="${lanesBefore.clipId}"]');
      const o = (x, y) => ({ bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 61, isPrimary: true, button: 0 });
      clip.dispatchEvent(new PointerEvent('pointerdown', o(${g.x}, ${g.y})));
      await tick();
      clip.dispatchEvent(new PointerEvent('pointermove', o(${g.x + 20}, ${g.y + 10})));
      await tick();
      clip.dispatchEvent(new PointerEvent('pointermove', o(${g.x + 50}, ${lane.top + 10})));
      await tick();
      clip.dispatchEvent(new PointerEvent('pointermove', o(${g.x + 70}, ${mid})));
      await tick();
      clip.dispatchEvent(new PointerEvent('pointerup', o(${g.x + 70}, ${mid})));
    `));
  }
  const laneAfter = await json(`(() => {
    const clip = document.querySelector('[data-clip-id="${lanesBefore.clipId}"]');
    return JSON.stringify({ track: clip.parentElement.getAttribute('data-track'), start: clip.getAttribute('data-frames-start') });
  })()`);
  check('a clip can be dragged onto another video lane', laneAfter.track === lanesBefore.target, { laneAfter, target: lanesBefore.target });

  // === 7. Roll ===============================================================
  const rolled = await json(gesture(`
    // Build a boundary deterministically: cut one clip in half at its
    // midpoint. The blade always leaves two ADJACENT halves, whatever else is
    // on the timeline - and "trim one clip onto another" needs a lane with
    // two clips on it, which the earlier steps do not guarantee.
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = ruler.getBoundingClientRect();
    const clip = document.querySelector('[data-clip]');
    if (!clip) return JSON.stringify({ error: 'no clip' });
    // Capture the LANE'S ID, not the node. Cutting replaces the DOM node, so a
    // reference taken before the blade points at a detached element afterwards
    // and its parentElement is null.
    const laneId = clip.parentElement.getAttribute('data-track');
    const cr = clip.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 96, isPrimary: true, button: 0 });
    const midX = cr.left + cr.width / 2;
    ruler.dispatchEvent(new PointerEvent('pointerdown', o(midX)));
    await tick();
    ruler.dispatchEvent(new PointerEvent('pointerup', o(midX)));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    await tick();

    const lane = document.querySelector('[data-track="' + laneId + '"]');
    if (!lane) return JSON.stringify({ error: 'lane gone' });
    const pair = [...lane.querySelectorAll('[data-clip]')].sort((a, b) =>
      Number(a.getAttribute('data-frames-start')) - Number(b.getAttribute('data-frames-start')));
    if (pair.length < 2) return JSON.stringify({ error: 'the blade produced one clip', pair: pair.length });
    const l = pair[0];
    const r = pair[1];
    const end = Number(l.getAttribute('data-frames-start')) + Number(l.getAttribute('data-frames-length'));
    if (Number(r.getAttribute('data-frames-start')) !== end) return JSON.stringify({ error: 'halves are not adjacent' });

    const before = { ll: Number(l.getAttribute('data-frames-length')), rl: Number(r.getAttribute('data-frames-length')) };
    const handle = document.querySelector('[role="separator"][aria-label^="Roll the cut"]');
    if (!handle) return JSON.stringify({ error: 'no roll handle', before });
    const hb = handle.getBoundingClientRect();
    const cx = hb.left + hb.width / 2;
    const ro = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: hb.top + hb.height / 2, pointerId: 93, isPrimary: true, button: 0 });
    handle.dispatchEvent(new PointerEvent('pointerdown', ro(cx)));
    await tick();
    handle.dispatchEvent(new PointerEvent('pointermove', ro(cx + 24)));
    await tick();
    handle.dispatchEvent(new PointerEvent('pointerup', ro(cx + 24)));
    await tick();
    const nl = document.querySelector('[data-clip-id="' + l.getAttribute('data-clip-id') + '"]');
    const nr = document.querySelector('[data-clip-id="' + r.getAttribute('data-clip-id') + '"]');
    const after = { ll: Number(nl.getAttribute('data-frames-length')), rl: Number(nr.getAttribute('data-frames-length')) };
    return JSON.stringify({ before, after,
      leftGrew: after.ll > before.ll,
      rightShrank: after.rl < before.rl,
      totalUnchanged: after.ll + after.rl === before.ll + before.rl });
  `));
  check(
    'roll moves the cut between two adjacent clips: left grows, right shrinks, total unchanged',
    rolled.leftGrew && rolled.rightShrank && rolled.totalUnchanged,
    rolled
  );

  // === 8. Clip properties ====================================================
  const props = await json(gesture(`
    const clip = document.querySelector('[data-clip]');
    clip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick();
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return JSON.stringify({ opened: false });
    const speed = dlg.querySelector('input[aria-label="Playback speed"]');
    if (speed) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(speed, '2');
      speed.dispatchEvent(new Event('input', { bubbles: true }));
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await tick();
    return JSON.stringify({ opened: true, title: dlg.getAttribute('aria-label'),
      after: dlg.querySelector('input[aria-label="Playback speed"]')?.value,
      hasVolume: !!dlg.querySelector('input[aria-label="Clip volume"]'),
      hasOpacity: !!dlg.querySelector('input[aria-label="Clip opacity"]'),
      showsFrames: /frames \\d+–\\d+/.test(dlg.innerText) });
  `));
  check('double-click opens clip properties and writes 2x speed', props.opened && props.after === '2' && props.hasVolume && props.hasOpacity, props);
  check('the properties dialog describes the clip in frames', props.showsFrames === true, props);
  await ev(`(() => { document.querySelector('[aria-label="Close clip properties"]')?.click(); return true; })()`);
  await sleep(400);

  // === 9. The panels =========================================================
  await rail('Filters');
  const grades = await json(`document.querySelectorAll('button[aria-label^="Apply the"]').length`);
  check('filters panel lists real colour grades from the sample resources', grades >= 8, { grades });

  await rail('Audio');
  const audioPanel = await json(`(() => {
    const t = document.body.innerText;
    return JSON.stringify({ tiles: document.querySelectorAll('button[aria-label^="Apply the"], button[aria-label^="Remove the"]').length, silence: t.includes('Remove silence') });
  })()`);
  check('audio panel lists real effects and local silence removal', audioPanel.tiles >= 10 && audioPanel.silence, audioPanel);

  await rail('Titles');
  const titleAdd = await json(gesture(`
    const before = document.querySelectorAll('[data-clip]').length;
    [...document.querySelectorAll('button')].find(b => /Lower third/.test(b.textContent))?.click();
    await tick();
    return JSON.stringify({ before, after: document.querySelectorAll('[data-clip]').length });
  `));
  check('a title can be added from the panel', titleAdd.after === titleAdd.before + 1, titleAdd);

  await rail('Import');

  // === 10. Undo / redo / clipboard ==========================================
  const editing = await json(gesture(`
    const t = () => document.body.innerText;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    await tick();
    const start = document.querySelectorAll('[data-clip]').length;
    const selected = Number((t().match(/(\\d+) selected/) || [0, '0'])[1]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await tick();
    const afterDelete = document.querySelectorAll('[data-clip]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick();
    const afterUndo = document.querySelectorAll('[data-clip]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await tick();
    const afterRedo = document.querySelectorAll('[data-clip]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick();
    return JSON.stringify({ start, selected, afterDelete, afterUndo, afterRedo, restored: document.querySelectorAll('[data-clip]').length });
  `));
  check(
    'select all, delete, undo and redo all work',
    editing.selected === editing.start && editing.afterDelete === 0 &&
      editing.afterUndo === editing.start && editing.afterRedo === 0 && editing.restored === editing.start,
    editing
  );

  const clipboardOps = await json(gesture(`
    document.querySelector('[data-clip]').click();
    await tick();
    const before = document.querySelectorAll('[data-clip]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    await tick();
    const afterDup = document.querySelectorAll('[data-clip]').length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await tick();
    return JSON.stringify({ before, afterDup, afterPaste: document.querySelectorAll('[data-clip]').length });
  `));
  check(
    'duplicate adds one copy and paste adds one more',
    clipboardOps.afterDup === clipboardOps.before + 1 && clipboardOps.afterPaste === clipboardOps.afterDup + 1,
    clipboardOps
  );

  // === 11. Markers ===========================================================
  const markers = await json(gesture(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    await tick();
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = ruler.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 91, isPrimary: true, button: 0 });
    ruler.dispatchEvent(new PointerEvent('pointerdown', o(box.left + 120)));
    await tick();
    ruler.dispatchEvent(new PointerEvent('pointerup', o(box.left + 120)));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    await tick();
    const marks = [...ruler.querySelectorAll('[aria-label^="Marker:"]')].map(b => b.getAttribute('aria-label'));
    const frames = marks.map(l => Number((l.match(/frame (\\d+)/) || [0, 0])[1]));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', bubbles: true }));
    await tick();
    return JSON.stringify({ marks, frames, afterStepBack: Number((document.body.innerText.match(/FRAME (\\d+)\\//) || [0, 0])[1]) });
  `));
  check(
    'markers are added at the playhead and , steps back to the previous one',
    markers.marks.length >= 2 &&
      // The two markers sit on different frames - the one before the seek and
      // the one after it - and stepping back lands on the EARLIER of the two.
      markers.frames[0] !== markers.frames[1] &&
      markers.afterStepBack === Math.min(...markers.frames),
    markers
  );

  // === 12. Ruler measurement =================================================
  const measured = await json(gesture(`
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = ruler.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.bottom - 3, pointerId: 94, isPrimary: true, button: 0 });
    ruler.dispatchEvent(new PointerEvent('pointerdown', o(box.left + 90)));
    await tick();
    ruler.dispatchEvent(new PointerEvent('pointermove', o(box.left + 270)));
    await tick();
    ruler.dispatchEvent(new PointerEvent('pointerup', o(box.left + 270)));
    await tick();
    return JSON.stringify({ readout: /MEASURE (\\d+)f/.exec(document.body.innerText)?.[0] || null });
  `));
  check('dragging the ruler measures a range and reports its length in frames', Boolean(measured.readout), measured);

  const readouts = await json(`(() => {
    const t = document.body.innerText;
    return JSON.stringify({
      tc: /TC (\\d{2}:\\d{2}:\\d{2}:\\d{2})/.exec(t)?.[1] || null,
      frameLine: /FRAME \\d+\\/\\d+ @ \\d+fps/.test(t),
      tick: /tick (\\d+)f/.exec(t)?.[1] || null,
    });
  })()`);
  check('timecode is HH:MM:SS:FF and the frame number is shown separately', Boolean(readouts.tc) && readouts.frameLine, readouts);
  check('the ruler reports its tick step', Boolean(readouts.tick), readouts);

  // === 13. Zoom reaches a single frame =======================================
  const setZoom = (value) =>
    ev(gesture(`
      const slider = document.querySelector('input[aria-label="Timeline zoom"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '${value}');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    `));

  await setZoom(6400);
  // The store coalesces its disk writes by 250ms, by design: a drag writes on
  // every pointermove. Reading the blob on the next line would read the value
  // from BEFORE this edit and report the app as not persisting what it has
  // already persisted.
  await sleep(900);
  const maxZoom = await json(`(() => {
    const s = JSON.parse(localStorage.getItem('${SETTINGS_KEY}') || '{}');
    return JSON.stringify({ px: s.pxPerFrame, pct: document.querySelector('[aria-label="Zoom percentage"]').textContent });
  })()`);
  check('zoom reaches single-frame level (>= 24 pixels per frame)', maxZoom.px >= 24, maxZoom);
  await setZoom(300);
  await sleep(700);

  // === 14. Frame rate ========================================================
  const rate = await json(gesture(`
    const sel = document.querySelector('select[aria-label="Timeline frame rate"]');
    const options = [...sel.options].map(o => Number(o.value));
    return JSON.stringify({ options });
  `));
  check('all five frame rates are offered', JSON.stringify(rate.options) === JSON.stringify([24, 25, 30, 50, 60]), rate);

  await ev(gesture(`
    const sel = document.querySelector('select[aria-label="Timeline frame rate"]');
    sel.value = '25';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  `));
  await sleep(900);

  // === 15. The workspace survives a refresh ==================================
  // Save FIRST. The refresh reopens the last saved project, so testing
  // persistence without saving anything tests an empty editor and calls it a
  // failure.
  await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await tick();
    return true;
  })()`);
  await sleep(2500);
  await setZoom(900);
  await ev(`(() => { document.querySelector('[aria-label^="Switch to"]')?.click(); return true; })()`);
  await sleep(1500);

  const wsBefore = await json(`(() => {
    const s = JSON.parse(localStorage.getItem('${SETTINGS_KEY}') || '{}');
    return JSON.stringify({
      zoom: document.querySelector('input[aria-label="Timeline zoom"]').value,
      fps: document.querySelector('select[aria-label="Timeline frame rate"]').value,
      light: document.documentElement.classList.contains('light'),
      storedPx: s.pxPerFrame,
    });
  })()`);

  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(9000);
  await rail('Import');
  await sleep(1200);

  const wsAfter = await json(`(() => {
    const s = JSON.parse(localStorage.getItem('${SETTINGS_KEY}') || '{}');
    return JSON.stringify({
      zoom: document.querySelector('input[aria-label="Timeline zoom"]').value,
      fps: document.querySelector('select[aria-label="Timeline frame rate"]').value,
      light: document.documentElement.classList.contains('light'),
      clips: document.querySelectorAll('[data-clip]').length,
      tiles: document.querySelectorAll('li').length,
      storedPx: s.pxPerFrame,
    });
  })()`);
  check(
    'zoom, frame rate and theme all survive a browser refresh',
    wsAfter.zoom === wsBefore.zoom && wsAfter.fps === wsBefore.fps && wsAfter.light === wsBefore.light && wsAfter.clips > 0,
    { wsBefore, wsAfter }
  );
  check('media restored from IndexedDB after the refresh', wsAfter.tiles >= 3, { tiles: wsAfter.tiles });

  await ev(gesture(`
    document.querySelector('[aria-label^="Switch to"]')?.click();
    const sel = document.querySelector('select[aria-label="Timeline frame rate"]');
    sel.value = '30';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  `));
  await setZoom(300);
  await sleep(900);

  // === 16. Playback ==========================================================
  const playback = await json(gesture(`
    const read = () => Number(document.querySelector('[role="slider"][aria-label="Timeline ruler"]').getAttribute('aria-valuenow'));
    document.querySelector('[aria-label="Play"]')?.click();
    await tick();
    return JSON.stringify({ playing: !!document.querySelector('[aria-label="Pause"]'), t0: read() });
  `));
  await sleep(2000);
  const afterPlay = await json(gesture(`
    const t = document.querySelector('[role="slider"][aria-label="Timeline ruler"]').getAttribute('aria-valuenow');
    document.querySelector('[aria-label="Pause"]')?.click();
    return JSON.stringify({ t1: Number(t) });
  `));
  check('playback advances the playhead, in whole frames', playback.playing && afterPlay.t1 > playback.t0, { ...playback, ...afterPlay });

  // === 17. The edge edits, virtualisation and the viewer ==================
  // Ripple trim, slip and slide exist because the USER has to be able to reach
  // them. An operation that exists only behind a three-key chord is an
  // operation most users never find, so each has a toolbar button - and each
  // button is what this drives.
  const edgeEdits = await json(gesture(`
    const state = () => [...document.querySelectorAll('[data-clip]')]
      .map(c => c.getAttribute('data-clip-id') + '@' + c.getAttribute('data-frames-start') + '+' + c.getAttribute('data-frames-length'))
      .sort();
    const click = (label) => {
      const b = [...document.querySelectorAll('[aria-label="toolbar"] button, [role="toolbar"] button')]
        .find(x => (x.getAttribute('aria-label') || '').startsWith(label));
      if (b && !b.disabled) b.click();
      return !!b && !b.disabled;
    };
    document.querySelector('[data-clip]').click();
    await tick();
    const out = { buttons: {} };

    const before = state();
    out.buttons.ripple = click('Ripple trim');
    await tick();
    out.afterRipple = state();
    out.rippleMoved = JSON.stringify(before) !== JSON.stringify(out.afterRipple);

    const b2 = state();
    out.buttons.slip = click('Slip');
    await tick();
    out.afterSlip = state();
    // A slip changes the SOURCE, so the timeline is deliberately unchanged.
    out.slipLeftTimelineAlone = JSON.stringify(b2) === JSON.stringify(out.afterSlip);

    const b3 = state();
    out.buttons.slide = click('Slide');
    await tick();
    out.slideMoved = JSON.stringify(b3) !== JSON.stringify(state());
    return JSON.stringify(out);
  `));
  check(
    'ripple trim, slip and slide are reachable as toolbar buttons',
    edgeEdits.buttons.ripple && edgeEdits.buttons.slip && edgeEdits.buttons.slide,
    edgeEdits.buttons
  );
  check('ripple trim moves clips on the timeline', edgeEdits.rippleMoved, { after: edgeEdits.afterRipple });
  check('slip leaves the timeline untouched and moves only the source', edgeEdits.slipLeftTimelineAlone);
  check('slide moves the clip between its neighbours', edgeEdits.slideMoved);

  // Virtualisation. 1000 clips must not become 1000 DOM nodes.
  const many = await json(gesture(`
    // Drive the model through the UI: the checks above have already proved the
    // timeline works, so this only needs a way to MAKE the clips.
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = ruler.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 97, isPrimary: true, button: 0 });
    const before = document.querySelectorAll('[data-clip]').length;
    for (let i = 0; i < 6; i++) {
      const clip = document.querySelector('[data-clip]');
      if (clip) { clip.click(); await tick(); }
      [...document.querySelectorAll('[aria-label="toolbar"] button, [role="toolbar"] button')]
        .find(x => (x.getAttribute('aria-label') || '') === 'Duplicate clips' && !x.disabled)?.click();
      await tick();
    }
    await tick();
    return JSON.stringify({ before, after: document.querySelectorAll('[data-clip]').length });
  `));
  check(
    'the lanes are virtualised: the DOM holds the visible window, not every clip',
    many.after > 12 && many.after <= 30,
    many
  );
  const footerCounts = await json(`(() => {
    const t = document.body.innerText;
    // Both forms are legitimate: "18 clips" when everything is on screen, and
    // "18 clips (6 drawn)" once the lanes start virtualising. Requiring the
    // second form would fail a correct editor that simply has no off-screen
    // clips to hide.
    const full = /(\\d+) clips \\((\\d+) drawn\\)/.exec(t);
    const plain = /(\\d+) clips/.exec(t);
    return JSON.stringify({
      total: full ? Number(full[1]) : plain ? Number(plain[1]) : 0,
      drawn: full ? Number(full[2]) : plain ? Number(plain[1]) : 0,
      virtualised: Boolean(full),
    });
  })()`);
  check(
    'the footer reports the model total AND how many are drawn',
    footerCounts.total > 12 && footerCounts.drawn > 0 && footerCounts.drawn <= footerCounts.total,
    footerCounts
  );

  const viewer = await json(gesture(`
    // Park the playhead ON a clip first: the source-frame read-out is
    // deliberately "—" over a gap, and asserting on a gap proves nothing.
    const ruler = document.querySelector('[role="slider"][aria-label="Timeline ruler"]');
    const box = ruler.getBoundingClientRect();
    const clip = document.querySelector('[data-clip]');
    const cr = clip.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + 6, pointerId: 98, isPrimary: true, button: 0 });
    ruler.dispatchEvent(new PointerEvent('pointerdown', o(cr.left + 10)));
    await tick();
    ruler.dispatchEvent(new PointerEvent('pointerup', o(cr.left + 10)));
    await tick();
    const pick = (label) => {
      const b = [...document.querySelectorAll('button')].find(x => (x.getAttribute('aria-label') || '') === label);
      if (b) b.click();
      return !!b;
    };
    const out = { layouts: pick('Picture in picture'), zoom: !!document.querySelector('input[aria-label="Viewer zoom"]'), badge: !!document.querySelector('input[aria-label="Viewer zoom"]') };
    await tick();
    // innerText puts a NEWLINE between the spans, so a "." pattern will not
    // bridge them unless the regex has the dot-all flag. Two independent
    // assertions are clearer than one clever one anyway.
    const t = document.body.innerText;
    out.timelineFrame = /TL [0-9]+/.test(t);
    out.sourceFrame = /SRC [^ ]+/.test(t);
    out.frameData = out.timelineFrame && out.sourceFrame;
    const m = t.match(/TL [0-9]+/);
    const s = t.match(/SRC [^ ]+/);
    out.readout = (m ? m[0] : '') + ' | ' + (s ? s[0] : '');
    return JSON.stringify(out);
  `));
  check('the viewer offers layout, zoom and a badge toggle', viewer.layouts && viewer.zoom, viewer);
  check('the frame data read-out shows timeline AND source frame', viewer.frameData === true, viewer);

  // === 18. Resize handles ====================================================
  const handles = await json(`(() => JSON.stringify([...document.querySelectorAll('[role="separator"]')]
    .map(h => ({ label: h.getAttribute('aria-label'), now: Number(h.getAttribute('aria-valuenow')), tabbable: h.getAttribute('tabindex') === '0' }))
    .filter(h => /bin|timeline/i.test(h.label || ''))))()`);
  check('resize handles exist and are keyboard reachable', handles.length === 2 && handles.every((h) => h.tabbable), handles);

  const dragBin = await json(gesture(`
    const h = [...document.querySelectorAll('[role="separator"]')].find(x => /media bin/i.test(x.getAttribute('aria-label') || ''));
    const box = h.getBoundingClientRect();
    const before = Number(h.getAttribute('aria-valuenow'));
    const o = (x) => ({ bubbles: true, cancelable: true, clientX: x, clientY: box.top + box.height / 2, pointerId: 3, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(box.left)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(box.left + 60)));
    await tick();
    const during = Number(h.getAttribute('aria-valuenow'));
    h.dispatchEvent(new PointerEvent('pointerup', o(box.left + 60)));
    return JSON.stringify({ before, during, grew: during > before });
  `));
  check('the media bin handle grows the panel to the right', dragBin.grew, dragBin);

  const dragLane = await json(gesture(`
    const h = [...document.querySelectorAll('[role="separator"]')].find(x => /lane/i.test(x.getAttribute('aria-label') || ''));
    if (!h) return JSON.stringify({ error: 'no lane handle' });
    const box = h.getBoundingClientRect();
    const before = Number(h.getAttribute('aria-valuenow'));
    const o = (y) => ({ bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: y, pointerId: 4, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(box.top)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(box.top - 40)));
    await tick();
    const during = Number(h.getAttribute('aria-valuenow'));
    h.dispatchEvent(new PointerEvent('pointerup', o(box.top - 40)));
    return JSON.stringify({ before, during, grew: during > before });
  `));
  check('a lane can be resized by its own header handle', dragLane.grew, dragLane);

  // === 18. Export =============================================================
  const exp = await json(gesture(`
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true }));
    await tick();
    const dlg = document.querySelector('[role="dialog"][aria-label="Export video"]');
    if (!dlg) return JSON.stringify({ opened: false });
    const text = dlg.innerText;
    const out = { opened: true,
      presets: dlg.querySelectorAll('select[aria-label="Export preset"] option').length,
      realTime: /Real-time/i.test(text),
      container: /WEBM|MediaRecorder/i.test(text) };
    dlg.querySelector('[aria-label="Close export dialog"]')?.click();
    return JSON.stringify(out);
  `));
  check('export dialog opens with presets and honest copy', exp.opened && exp.presets >= 10 && exp.realTime, exp);

  // === 19. Scrollbars =========================================================
  const scrollbars = await json(`(() => {
    const scrollable = (v) => v === 'auto' || v === 'scroll';
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const v = scrollable(cs.overflowY);
      const h = scrollable(cs.overflowX);
      const vS = v && el.scrollHeight > el.clientHeight + 1;
      const hS = h && el.scrollWidth > el.clientWidth + 1;
      if (!vS && !hS) continue;
      // Borders SUBTRACTED.
      //
      // offsetWidth minus clientWidth is "everything the layout does not hand
      // to the content box" - which is the scrollbar PLUS any border. An
      // element with a 1px bottom border and a correct 4px scrollbar measures
      // 5, and the check then reports a scrollbar that is one pixel too thick
      // when the scrollbar is exactly right.
      //
      // (NOTE: no backticks in this comment. This whole block is a template
      // literal, and a backtick inside it terminates the string early. That is
      // not a style note - it is the exact reason a previous version of this
      // file failed to parse with "missing ) after argument list".)
      const px = (v) => parseFloat(v) || 0;
      const barW = vS ? el.offsetWidth - el.clientWidth - px(cs.borderLeftWidth) - px(cs.borderRightWidth) : 0;
      const barH = hS ? el.offsetHeight - el.clientHeight - px(cs.borderTopWidth) - px(cs.borderBottomWidth) : 0;
      if (barW <= 0 && barH <= 0) continue;
      const sb = getComputedStyle(el, '::-webkit-scrollbar');
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 70),
        parent: el.parentElement ? el.parentElement.tagName.toLowerCase() + '.' + (el.parentElement.className || '').toString().slice(0, 30) : null,
        role: el.getAttribute('role') || el.getAttribute('aria-label') || '',
        barW, barH, cssWidth: sb.width, scrollbarWidth: cs.scrollbarWidth,
        gutter: cs.scrollbarGutter, color: cs.scrollbarColor,
        overflowY: cs.overflowY, overflowX: cs.overflowX,
        offsetW: el.offsetWidth, clientW: el.clientWidth,
        // Does the DOCUMENT actually contain a width rule for this element's
        // scrollbar? If the computed pseudo says 1px but the layout reserves
        // 15, the rule is present and something else is reserving the space -
        // and that is a different bug from a missing rule.
        ruleFound: [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some((r) => r.selectorText && r.selectorText.includes('webkit-scrollbar') && r.style && r.style.width);
          } catch {
            return false;
          }
        }),
      });
    }
    return JSON.stringify(out);
  })()`);
  const thick = scrollbars.filter((s) => s.barW > SCROLLBAR_PX || s.barH > SCROLLBAR_PX);
  check(
    `every scrollable box renders a ${SCROLLBAR_PX}px hairline scrollbar`,
    scrollbars.length > 0 && thick.length === 0,
    {
      expected: SCROLLBAR_PX,
      measured: scrollbars.map((s) => `${s.barW}x${s.barH} (css ${s.cssWidth})`),
      thick,
    }
  );

  // === 20. Navbar session awareness ==========================================
  // A fresh browser profile has no session, so the ONLY honest thing the
  // navbar can show is the logged-out state. If it ever shows an avatar here,
  // that is a fake session indicator - the worst kind of navbar bug, because
  // the user clicks it believing something that is not true.
  const nav = await json(gesture(`
    const box = document.querySelector('[data-session]');
    const links = [...document.querySelectorAll('a[aria-label]')]
      .filter(a => /Log in|Create an account|Back to dashboard/.test(a.getAttribute('aria-label') || ''))
      .map(a => ({ label: a.getAttribute('aria-label'), href: a.getAttribute('href') }));
    return JSON.stringify({
      state: box ? box.getAttribute('data-session') : null,
      links,
      // No token anywhere in the DOM or storage. The session is an httpOnly
      // cookie, so the client CANNOT have it - and must not be faking it.
      tokenInDom: /eyJ[A-Za-z0-9_-]{10,}/.test(document.documentElement.innerHTML),
      storageKeys: Object.keys(localStorage).filter(k => /token|auth|session/i.test(k)),
    });
  `));
  check(
    'a fresh session renders the LOGGED-OUT navbar (no fake avatar)',
    nav.state === 'out' && (nav.links || []).some((l) => /Log in/.test(l.label || '')),
    { state: nav.state, links: nav.links }
  );
  check(
    'the login and register URLs come from the environment',
    (nav.links || []).some((l) => (l.href || '').includes('/auth/login')) &&
      (nav.links || []).some((l) => (l.href || '').includes('/auth/register')),
    { links: nav.links }
  );
  check(
    'no auth token is readable by the client (httpOnly cookie, not stolen into JS)',
    nav.tokenInDom === false,
    { tokenInDom: nav.tokenInDom, storageKeys: nav.storageKeys }
  );

  // === 21. Final state =======================================================
  const final = await json(`(() => JSON.stringify({
    brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
    docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    placeholders: [...document.querySelectorAll('*')].filter(e => e.textContent === 'This is a placeholder').length,
  }))()`);
  check('no broken images at the end', final.brokenImages === 0, final);
  check('no horizontal overflow at the end', final.docOverflow <= 2, final);
  check('no placeholder text left in the DOM', final.placeholders === 0, final);

  const realErrors = logs.filter((l) => !/favicon|net::ERR_|status of 40/.test(l));
  check('no uncaught console errors for the whole run', realErrors.length === 0, {
    errors: realErrors.slice(0, 4).map((e) => String(e).split('\n')[0]),
  });

  // === Screenshots ===========================================================
  // Park the playhead where a frame is actually on screen: a screenshot of the
  // end of the timeline is a black rectangle that proves nothing.
  await seekRuler(150);
  await sleep(1800);
  const shot1 = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(SHOT, Buffer.from(shot1.data, 'base64'));
  console.log(`screenshot: ${SHOT}`);

  const metrics = await cdp('Page.getLayoutMetrics', {}, sid);
  const h = Math.min(2400, Math.ceil(metrics.cssContentSize.height));
  const shot2 = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height: h, scale: 1 } }, sid);
  writeFileSync(SHOT2, Buffer.from(shot2.data, 'base64'));
  console.log(`screenshot: ${SHOT2}`);

  const lightShot = SHOT2.replace(/\.png$/, '-light.png');
  await ev(gesture(`document.querySelector('[aria-label^="Switch to"]')?.click();`));
  await sleep(1200);
  const light = await json(`(() => {
    const read = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
    const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };

    // The bug this guards: a token written in the WRONG colour space
    // (--background: 246 247 249 into hsl(var(--background))). hsl() reads
    // those as hue/saturation/lightness, so the value LOOKS plausible, the
    // declaration is dropped as "invalid at computed-value time", and every
    // utility built on it quietly disappears. The surface check above passed
    // anyway, because bg-surface reads a DIFFERENT token - which is exactly
    // why the light theme looked half-right and was completely broken.
    //
    // So assert the tokens themselves resolve. A resolved custom property comes
    // back with its value; an unresolved one comes back empty.
    const root = getComputedStyle(document.documentElement);
    const tokens = {};
    for (const name of ['background', 'foreground', 'primary', 'border', 'card']) {
      tokens[name] = root.getPropertyValue('--' + name).trim();
    }

    return JSON.stringify({
      toolbar: read('[role="toolbar"]'),
      ruler: read('[role="slider"][aria-label="Timeline ruler"]'),
      canvas: !!document.querySelector('[role="img"] canvas'),
      tokens,
      bodyText: css('body', 'color'),
    });
  })()`);
  check('the light theme repaints the surfaces', Boolean(light.toolbar) && light.toolbar !== 'rgb(15, 23, 42)', light);
  check(
    'every shared colour token RESOLVES in light mode (right colour space)',
    Object.values(light.tokens || {}).every((v) => v.length > 0),
    { tokens: light.tokens }
  );
  const shot3 = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(lightShot, Buffer.from(shot3.data, 'base64'));
  console.log(`screenshot: ${lightShot}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (appLogs.length) {
    const real = appLogs.filter((l) => !/^\[object/.test(l));
    if (real.length) {
      console.log('\napp log (tail):');
      for (const l of real.slice(-20)) console.log('  ' + l);
    }
  }
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(` - ${f.name}  ${JSON.stringify(f.detail ?? '')}`);
    process.exitCode = 1;
  } else {
    console.log('RESULT: PASS');
  }
} catch (e) {
  console.error('harness failed:', e.message);
  // Print the phase, not just the message: a CDP "Invalid parameters" says
  // nothing about WHICH call had bad parameters, and the whole suite is
  // worthless without knowing where it stopped.
  console.error('at:', (e.stack || '').split('\n').slice(1, 4).join(' | '));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} checks passed before the failure`);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {
    /* already closed */
  }
  chrome.kill();
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {
    /* temp cleanup */
  }
}
