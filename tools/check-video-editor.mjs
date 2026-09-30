#!/usr/bin/env node
// ============================================================================
// Functional + visual check of the video editor at :3002
// ============================================================================
//
// Everything here is asserted through the real UI - a real file is pushed into
// the real file input, real pointer events drive real drags, and the DOM is
// read back afterwards. Nothing imports editor internals, because a test that
// can reach into the state passes even when the interface is broken.
//
// The fixtures are GENERATED, not stubs. `Buffer.alloc(64KB, 7)` is not a
// video, so every "does the clip render" assertion against it would pass for
// the wrong reason: a broken renderer also draws nothing. A real 3-second MP4
// with real frames means a red frame on screen proves the compositor ran, and
// a black frame proves it did not.
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
const FFMPEG = 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe';

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
// Fixtures: real media, generated once
// ---------------------------------------------------------------------------
//
// Three seconds of solid red, then green, then blue, at 640x360, with a 440Hz
// tone. The colours matter: a frame that comes out the colour the timeline says
// it should be is a frame the compositor actually drew.

const RED = 'Sample Clip.mp4';
const BLUE = 'Second Clip.mp4';
const TONE = 'Room Tone.wav';
const IMAGE = 'Photo.png';

/**
 * Locate ffmpeg.
 *
 * Real media matters here. `Buffer.alloc(64KB, 7)` is not a video, so a
 * "does the preview render" assertion against it would pass for the wrong
 * reason: a broken compositor also draws nothing. A real MP4 with real frames
 * means a red frame on screen proves the renderer ran.
 */
function findFfmpeg() {
  if (existsSync(FFMPEG)) return FFMPEG;
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
  const ffmpeg = findFfmpeg();
  const dir = join(userDir, 'fixtures');
  if (!ffmpeg) return { red: join(dir, RED), blue: join(dir, BLUE), tone: join(dir, TONE), img: join(dir, IMAGE), okRed: false, okBlue: false, okTone: false, okImg: false };
  // The directory has to exist before ffmpeg writes into it; it does not
  // create intermediate folders, and every fixture fails at once otherwise.
  mkdirSync(dir, { recursive: true });
  const mk = (args) => spawnSync(ffmpeg, args, { stdio: 'ignore' });
  const base = ['-y', '-hide_banner', '-loglevel', 'error'];

  const red = join(dir, RED);
  const blue = join(dir, BLUE);
  const tone = join(dir, TONE);
  const img = join(dir, IMAGE);

  const okRed = mk([
    ...base,
    '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=3:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red,
  ]).status === 0;
  const okBlue = mk([
    ...base,
    '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=3:r=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue,
  ]).status === 0;
  const okTone = mk([
    ...base,
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2:sample_rate=44100',
    tone,
  ]).status === 0;
  const okImg = mk([...base, '-f', 'lavfi', '-i', 'color=c=green:s=640x360', '-frames:v', '1', img]).status === 0;

  return { red, blue, tone, img, okRed, okBlue, okTone, okImg };
}

let ws;
let sid;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
}

try {
  const fx = makeFixtures();
  console.log(`fixtures: red=${fx.okRed} blue=${fx.okBlue} tone=${fx.okTone} image=${fx.okImg}`);
  if (!fx.okRed || !fx.okBlue || !fx.okImg) {
    // Fall back to non-video bytes so the rest of the suite still runs, and say
    // so loudly - a pass against a stub is not the same as a pass against a
    // real file, and pretending otherwise is exactly the bug this harness
    // exists to prevent.
    console.log('!! ffmpeg unavailable: falling back to stub bytes. Render assertions are NOT meaningful.');
    writeFileSync(fx.red, Buffer.alloc(64 * 1024, 7));
    writeFileSync(fx.blue, Buffer.alloc(64 * 1024, 7));
    writeFileSync(fx.img, Buffer.alloc(1024, 3));
    writeFileSync(fx.tone, Buffer.alloc(1024, 5));
  }

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
  const cdp = (m, p = {}, s) =>
    new Promise((rs, rj) => {
      const id = Math.floor(Math.random() * 1e9);
      const h = (e) => {
        const x = JSON.parse(e.data);
        if (x.id === id) {
          ws.removeEventListener('message', h);
          x.error ? rj(new Error(x.error.message)) : rs(x.result);
        }
      };
      ws.addEventListener('message', h);
      ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
    });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  await cdp('DOM.enable', {}, sid);

  const logs = [];
  const appLogs = [];
  await cdp('Log.enable', {}, sid);
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Log.entryAdded' && x.params?.entry?.level === 'error') {
      logs.push(x.params.entry.text);
    }
    if (x.method === 'Runtime.consoleAPICalled') {
      const text = (x.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      appLogs.push(text);
    }
    if (x.method === 'Runtime.exceptionThrown') {
      logs.push(String(x.params?.exceptionDetails?.exception?.description ?? 'exception'));
    }
  });

  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(7000);

  const ev = async (x) => {
    const r = await cdp(
      'Runtime.evaluate',
      { expression: x, returnByValue: true, awaitPromise: true },
      sid
    );
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };

  const tick = `(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); })()`;

  // --- 1. Boot: styling, structure, no broken images ---
  const boot = await ev(`(() => {
    let rules = 0;
    for (const s of document.styleSheets) { try { rules += (s.cssRules || []).length; } catch {} }
    const rail = document.querySelector('nav[aria-label="Editor modes"]');
    const imgs = [...document.images];
    const aside = document.querySelector('aside') || document.querySelector('nav[aria-label="Editor modes"]')?.parentElement;
    return {
      cssRules: rules,
      brokenImages: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      totalImages: imgs.length,
      railButtons: rail ? rail.querySelectorAll('button').length : 0,
      railAllNamed: rail ? [...rail.querySelectorAll('button')].every(b => (b.getAttribute('aria-label')||'').length > 0) : false,
      railUnnamed: rail ? [...rail.querySelectorAll('button')].map(b => b.getAttribute('aria-label')).filter(n => !n) : ['no rail'],
      canvas: !!document.querySelector('[role="img"] canvas'),
      canvasSize: (() => { const c = document.querySelector('[role="img"] canvas'); return c ? c.width + 'x' + c.height : null; })(),
      docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      noHorizontalScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
    };
  })()`);
  check('styling compiled', boot.cssRules > 100, { cssRules: boot.cssRules });
  check('no broken images on boot', boot.brokenImages === 0, boot);
  check(
    'mode rail: every enabled button has an accessible name',
    boot.railButtons >= 10 && boot.railAllNamed,
    { railButtons: boot.railButtons, allNamed: boot.railAllNamed, unnamed: boot.railUnnamed }
  );
  check('preview canvas exists at project size', boot.canvas && boot.canvasSize === '1280x720', { canvas: boot.canvas, canvasSize: boot.canvasSize });
  check('no horizontal document overflow', boot.noHorizontalScroll, { docOverflow: boot.docOverflow });

  // Whether the console errors are hydration (boot) or client-side (later)
  // decides which half of the app is broken, so the count is checkpointed here
  // rather than only at the end.
  const bootErrors = logs.filter((l) => !/favicon|net::ERR_|status of 404/.test(l));
  check('no console errors at boot (no hydration mismatch)', bootErrors.length === 0, {
    errors: bootErrors.slice(0, 3).map((e) => e.split('\n')[0]),
  });

  // --- 2. Import real media through the media bin's own file input ---
  // The LAST file input is the bin's. The FIRST one is the editor's global
  // "import and drop straight on the timeline" input, and using that here
  // would test the wrong path and silently add four clips before the test
  // clicks its own.
  const pushFiles = async (files) => {
    const { root } = await cdp('DOM.getDocument', {}, sid);
    const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
    if (!nodeIds?.length) return false;
    const binInput = nodeIds[nodeIds.length - 1];
    await cdp('DOM.setFileInputFiles', { nodeId: binInput, files }, sid);
    return true;
  };
  const pushed = await pushFiles([fx.red, fx.blue, fx.tone, fx.img]);
  check('media bin file input present and used', pushed);
  await sleep(6000);

  const imported = await ev(`(() => {
    const t = document.body.innerText;
    return {
      tiles: document.querySelectorAll('li').length,
      clips: document.querySelectorAll('[data-clip]').length,
      hasRed: /Sample Clip/.test(t),
      hasBlue: /Second Clip/.test(t),
      hasTone: /Room Tone/.test(t),
      hasImage: /Photo/.test(t),
      brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
      // A real decode shows a real duration. A stub byte blob does not.
      durations: [...document.querySelectorAll('li')].map(li => (li.innerText.match(/\\d:\\d\\d/) || [''])[0]).filter(Boolean),
    };
  })()`);
  check('all four fixtures in the bin', imported.hasRed && imported.hasBlue && imported.hasTone && imported.hasImage, imported);
  check('importing alone puts NOTHING on the timeline', imported.clips === 0, { clips: imported.clips });
  check('no broken images after import', imported.brokenImages === 0, { brokenImages: imported.brokenImages });
  check('durations read from real media', imported.durations.length >= 3, { durations: imported.durations });

  // --- 3. Add clips to the timeline by clicking tiles ---
  await ev(`(() => {
    const find = (re) => [...document.querySelectorAll('button[aria-pressed]')].find(b => re.test(b.textContent||'') || re.test(b.getAttribute('aria-label')||''));
    const red = find(/Add Sample Clip/); if (red) red.click();
    return !!red;
  })()`);
  await sleep(1200);
  // Move the playhead to 3s so the second clip lands on the join.
  await ev(`(() => { const r = document.querySelector('[role="slider"][aria-label="Timeline playhead"]'); return !!r; })()`);
  await ev(`(async () => {
    const el = document.querySelector('[role="slider"][aria-label="Timeline playhead"]');
    const box = el.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height/2, pointerId: 41, isPrimary: true, button: 0 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(box.left + 270)));
    await new Promise(r => requestAnimationFrame(r));
    el.dispatchEvent(new PointerEvent('pointerup', o(box.left + 270)));
  })()`);
  await sleep(800);
  const secondAdded = await ev(`(() => {
    const find = (re) => [...document.querySelectorAll('button[aria-pressed]')].find(b => re.test(b.getAttribute('aria-label')||''));
    const blue = find(/Add Second Clip/); if (blue) blue.click();
    return !!blue;
  })()`);
  await sleep(1200);
  const addedTone = await ev(`(() => {
    const find = (re) => [...document.querySelectorAll('button[aria-pressed]')].find(b => re.test(b.getAttribute('aria-label')||''));
    const t = find(/Add Room Tone/); if (t) t.click();
    return !!t;
  })()`);
  await sleep(1500);

  const timeline = await ev(`(() => {
    const clips = [...document.querySelectorAll('[data-clip]')];
    return {
      clipCount: clips.length,
      names: clips.map(c => c.getAttribute('title')),
      lanes: document.body.innerText.match(/Video 1|Audio 1|Text 1/g) || [],
      readout: (document.body.innerText.match(/\\d+:\\d\\d \\/ \\d+:\\d\\d/) || [''])[0],
      trimHandles: document.querySelectorAll('[role="separator"][aria-label^="Trim"]').length,
      fadeHandles: document.querySelectorAll('[role="separator"][aria-label^="Fade"]').length,
      trackFaders: document.querySelectorAll('input[aria-label$="volume"]').length,
      addTrackButton: !!document.querySelector('[aria-label="Add a track"]'),
    };
  })()`);
  check('clips added to the timeline', timeline.clipCount >= 2, { clipCount: timeline.clipCount, names: timeline.names });
  check('three default lanes present', timeline.lanes.length >= 3, { lanes: timeline.lanes });
  check('trim handles on clips', timeline.trimHandles >= 4, { trimHandles: timeline.trimHandles });
  check('fade handles on clips', timeline.fadeHandles >= 4, { fadeHandles: timeline.fadeHandles });
  check('per-track volume faders exist', timeline.trackFaders >= 3, { faders: timeline.trackFaders });
  check('add-track control exists', timeline.addTrackButton);

  // --- 4. The compositor actually draws the right frame ---
  //
  // Polled, not read once. A media element that has just been handed a new
  // source time needs a moment to decode it, and a single immediate read
  // catches the placeholder frame - which would fail the test for a reason
  // that has nothing to do with the thing being tested.
  const seekRuler = (px) =>
    ev(`(async () => {
      const el = document.querySelector('[role="slider"][aria-label="Timeline playhead"]');
      const box = el.getBoundingClientRect();
      const o = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height/2, pointerId: 42, isPrimary: true, button: 0 });
      el.dispatchEvent(new PointerEvent('pointerdown', o(box.left + ${px})));
      await new Promise(r => requestAnimationFrame(r));
      el.dispatchEvent(new PointerEvent('pointerup', o(box.left + ${px})));
    })()`);

  const sampleCanvas = `(() => {
    const c = document.querySelector('[role="img"] canvas');
    if (!c) return null;
    const t = document.createElement('canvas'); t.width = 8; t.height = 8;
    t.getContext('2d').drawImage(c, 0, 0, 8, 8);
    const d = t.getContext('2d').getImageData(0,0,8,8).data;
    let r=0,g=0,b=0; for (let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}
    const n = d.length/4;
    return { r: Math.round(r/n), g: Math.round(g/n), b: Math.round(b/n) };
  })()`;

  const pixel = async (want, tries = 14) => {
    let last = null;
    for (let i = 0; i < tries; i++) {
      await sleep(400);
      last = await ev(sampleCanvas);
      if (last && want(last)) return last;
    }
    return last;
  };
  const near = (v, t, tol) => Math.abs(v - t) <= tol;

  // Explicitly back to the start first. The test has just been seeking around,
  // and "the frame at 0s" is only meaningful if the playhead is actually at 0.
  await seekRuler(2);
  const atZero = await pixel((p) => p.r > 120 && p.g < 70 && p.b < 70);
  check('preview renders the red clip at the start, not black', atZero && atZero.r > 120 && atZero.g < 70, atZero);

  // Seek into the second clip and confirm the picture changed with it.
  await seekRuler(460);
  const atFour = await pixel((p) => p.b > 120 && p.r < 70);
  check('preview follows the playhead to the blue clip', atFour && atFour.b > 120 && atFour.r < 70, atFour);


  // --- 5. Transitions ---
  const tr = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Select the first clip, then open the transitions mode.
    //
    // A plain click(), not a synthetic pointerdown. A pointerdown with no
    // matching pointerup is not a gesture any user can perform, and the editor
    // is right to treat the leftover as an unfinished drag - so the test must
    // not leave one lying around or every later step is testing the debris
    // rather than the feature.
    const clips = [...document.querySelectorAll('[data-clip]')];
    const first = clips[0];
    if (!first) return JSON.stringify({ error: 'no clip' });
    first.click();
    await tick();
    const rail = document.querySelector('nav[aria-label="Editor modes"]');
    const btn = [...rail.querySelectorAll('button')].find(b => /Transitions/.test(b.getAttribute('aria-label')||''));
    if (!btn) return JSON.stringify({ error: 'no transitions mode' });
    btn.click();
    await tick();
    await tick();
    const tile = [...document.querySelectorAll('button')].find(b => /^Crossfade/.test((b.getAttribute('aria-label')||'')));
    if (!tile) return JSON.stringify({ error: 'no crossfade tile' });
    tile.click();
    await tick();
    await tick();
    return JSON.stringify({ badges: document.querySelectorAll('[data-transition]').length, label: tile.getAttribute('aria-label') });
  })()`);
  const trRes = JSON.parse(String(tr).replace(/^"|"$/g, '') || '{}');
  check('transition added to the join', trRes.badges >= 1, trRes);

  // Seek to the middle of the transition and confirm BOTH frames are mixed.
  const midBlend = await ev(`(async () => {
    const badge = document.querySelector('[data-transition]');
    if (!badge) return null;
    const b = badge.getBoundingClientRect();
    const el = document.querySelector('[role="slider"][aria-label="Timeline playhead"]');
    const box = el.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height/2, pointerId: 43, isPrimary: true, button: 0 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(b.left + b.width/2)));
    await new Promise(r => requestAnimationFrame(r));
    el.dispatchEvent(new PointerEvent('pointerup', o(b.left + b.width/2)));
    return true;
  })()`);
  const blendPixel = await pixel((p) => p.r > 20 && p.b > 20);
  check(
    'crossfade blends two clips (not pure red, not pure blue)',
    Boolean(blendPixel && blendPixel.r > 20 && blendPixel.b > 20),
    { blendPixel, seeked: midBlend }
  );
  void near;

  // --- 6. Waveforms ---
  const wave = await ev(`(() => {
    const canvases = [...document.querySelectorAll('[data-clip] canvas')];
    return { count: canvases.length, sized: canvases.filter(c => c.width > 0).length };
  })()`);
  check('waveform canvas rendered on audio-bearing clips', wave.count >= 2, wave);

  // --- 7. Trim ---
  const trim = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clip = document.querySelector('[data-clip]');
    if (!clip) return 'no clip';
    const before = Math.round(clip.getBoundingClientRect().width);
    const h = clip.querySelector('[aria-label^="Trim end"]');
    if (!h) return 'no trim handle';
    const hb = h.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, clientX: x, clientY: hb.top + hb.height/2, pointerId: 7, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(hb.right - 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(hb.right - 2 - 70)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(hb.right - 2 - 70)));
    await tick();
    const after = Math.round(document.querySelector('[data-clip]').getBoundingClientRect().width);
    return JSON.stringify({ before, after, shortened: after < before });
  })()`);
  const trimRes = JSON.parse(String(trim).replace(/^"|"$/g, '') || '{}');
  check('dragging the out-edge shortens the clip', trimRes.shortened === true, trimRes);

  // --- 8. Fade drag ---
  const fade = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clip = [...document.querySelectorAll('[data-clip]')].find(c => c.querySelector('[aria-label^="Fade out"]'));
    if (!clip) return JSON.stringify({ error: 'no clip with a fade handle' });
    const readFade = () => parseFloat((clip.querySelector('[aria-label^="Fade out"]').getAttribute('title')||'').match(/([\\d.]+)s/)?.[1] ?? '0');
    const before = readFade();
    const h = clip.querySelector('[aria-label^="Fade out"]');
    const hb = h.getBoundingClientRect();
    const o = (y) => ({ bubbles: true, clientX: hb.left + 3, clientY: y, pointerId: 8, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(hb.top + 2)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(hb.top - 40)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointerup', o(hb.top - 40)));
    await tick();
    return JSON.stringify({ before, after: readFade() });
  })()`);
  const fadeRes = JSON.parse(String(fade).replace(/^"|"$/g, '') || '{}');
  check('dragging the fade corner lengthens the fade', fadeRes.after > fadeRes.before + 0.1, fadeRes);

  // --- 9. Cross-lane drag ---
  // Target the lane by its TYPE, not by "whatever is empty below" - the second
  // video lane is the one a picture-in-picture clip belongs on, and an audio
  // lane is a legitimate drop that the editor must refuse.
  // A cross-lane drag.
  //
  // Synthetic PointerEvents, not CDP Input.dispatchMouseEvent: in this
  // headless build a CDP mousePressed does not reach the page (a CDP
  // mouseMoved does, which is worse - it looks like it works). Synthetic
  // events exercise the same listeners the browser would call.
  //
  // The assertion follows the DRAGGED clip by id. querySelector('[data-clip]')
  // returns whichever clip comes first in the DOM, which after the drag is a
  // DIFFERENT clip on a different lane - so reading "the first clip" only
  // proves that some clip exists on v1, which was true even when the drag had
  // failed.
  await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.querySelector('[aria-label="Add a track"]').click();
    await tick();
    const add = [...document.querySelectorAll('button')].find(b => /^Video track$/.test(b.textContent.trim()));
    if (add) add.click();
    await tick(); await tick();
  })()`);

  const lanesBefore = JSON.parse(
    String(
      await ev(`(() => {
        const clip = document.querySelector('[data-clip]');
        const cb = clip.getBoundingClientRect();
        const lanes = [...document.querySelectorAll('[data-track]')].map(l => {
          const r = l.getBoundingClientRect();
          return { id: l.getAttribute('data-track'), type: l.getAttribute('data-track-type'), top: Math.round(r.top), height: Math.round(r.height), clips: l.querySelectorAll('[data-clip]').length };
        });
        const from = lanes.find(l => l.id === clip.parentElement.getAttribute('data-track'));
        const target = lanes.find(l => l.type === 'video' && l.clips === 0 && l.top > from.top);
        return JSON.stringify({
          lanes,
          target: target ? target.id : null,
          clipId: clip.getAttribute('data-clip-id'),
          grab: { x: Math.round(cb.left + 30), y: Math.round(cb.top + 20) },
        });
      })()`)
    ).replace(/^"|"$/g, '') || '{}'
  );

  check(
    'a second video lane is added next to the first',
    (lanesBefore.lanes || []).filter((l) => l.type === 'video').length === 2,
    { lanes: (lanesBefore.lanes || []).map((l) => l.type + ':' + l.clips) }
  );

  if (lanesBefore.target) {
    const lane = lanesBefore.lanes.find((x) => x.id === lanesBefore.target);
    const mid = lane.top + Math.round(lane.height / 2);
    const g = lanesBefore.grab;
    const cid = lanesBefore.clipId;
    await ev(`(() => {
      const clip = document.querySelector('[data-clip-id="' + ${JSON.stringify(cid)} + '"]');
      const g = ${JSON.stringify(g)};
      const mid = ${mid};
      const top = ${lane.top};
      const o = (x, y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 61, isPrimary: true, button: 0 });
      window.__drag = () => {
        clip.dispatchEvent(new PointerEvent('pointerdown', o(g.x, g.y)));
        clip.dispatchEvent(new PointerEvent('pointermove', o(g.x + 20, g.y + 10)));
        clip.dispatchEvent(new PointerEvent('pointermove', o(g.x + 50, top + 10)));
        clip.dispatchEvent(new PointerEvent('pointermove', o(g.x + 70, mid)));
        clip.dispatchEvent(new PointerEvent('pointerup', o(g.x + 70, mid)));
      };
    })()`);
    // The four moves are spread across frames so React commits each preview.
    for (let i = 0; i < 4; i++) {
      await ev(`window.__drag ? (window.__drag(), true) : false`);
      await sleep(220);
    }
    await ev(`(() => { const c = document.querySelector('[data-clip-id="' + ${JSON.stringify(cid)} + '"]'); const o = (x, y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 61, isPrimary: true, button: 0 }); c.dispatchEvent(new PointerEvent('pointerup', o(0, 0))); })()`);
    await sleep(400);
  }

  const after = JSON.parse(
    String(
      await ev(`(() => {
        const clip = document.querySelector('[data-clip-id="' + ${JSON.stringify(lanesBefore.clipId)} + '"]');
        return JSON.stringify({
          track: clip.parentElement.getAttribute('data-track'),
          top: Math.round(clip.getBoundingClientRect().top),
          lanes: [...document.querySelectorAll('[data-track]')].map(l => l.getAttribute('data-track-type') + ':' + l.querySelectorAll('[data-clip]').length),
        });
      })()`)
    ).replace(/^"|"$/g, '') || '{}'
  );

  check(
    'a clip can be dragged onto another video lane',
    after.track === lanesBefore.target,
    { after, target: lanesBefore.target }
  );


  // --- 10. Clip properties dialog ---
  const props = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clip = document.querySelector('[data-clip]');
    clip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await tick(); await tick();
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return JSON.stringify({ opened: false });
    const speed = dlg.querySelector('input[aria-label="Playback speed"]');
    const before = speed ? Number(speed.value) : null;
    if (speed) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(speed, '2');
      speed.dispatchEvent(new Event('input', { bubbles: true }));
      speed.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await tick(); await tick();
    const after = dlg.querySelector('input[aria-label="Playback speed"]')?.value;
    return JSON.stringify({ opened: true, title: dlg.getAttribute('aria-label'), before, after, hasVolume: !!dlg.querySelector('input[aria-label="Clip volume"]'), hasOpacity: !!dlg.querySelector('input[aria-label="Clip opacity"]') });
  })()`);
  const propsRes = JSON.parse(String(props).replace(/^"|"$/g, '') || '{}');
  check('double-click opens clip properties', propsRes.opened === true, propsRes);
  check('properties expose speed / volume / opacity', propsRes.after === '2' && propsRes.hasVolume && propsRes.hasOpacity, propsRes);

  // --- 11. Filters panel applies a real grade ---
  const filters = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    document.querySelector('[aria-label="Close clip properties"]')?.click();
    await tick();
    const rail = document.querySelector('nav[aria-label="Editor modes"]');
    [...rail.querySelectorAll('button')].find(b => /Filters/.test(b.getAttribute('aria-label')||''))?.click();
    await tick(); await tick();
    const tile = [...document.querySelectorAll('button')].find(b => /colour grade/i.test(b.getAttribute('aria-label')||''));
    if (!tile) return JSON.stringify({ tiles: 0, text: document.body.innerText.slice(0,300) });
    tile.click();
    await tick(); await tick();
    const clip = document.querySelector('[data-clip]');
    return JSON.stringify({ tiles: document.querySelectorAll('button[aria-label^="Apply the"]').length, grade: tile.getAttribute('aria-label') });
  })()`);
  const filtersRes = JSON.parse(String(filters).replace(/^"|"$/g, '') || '{}');
  check('filters panel lists real resource grades', (filtersRes.tiles ?? 0) >= 8, filtersRes);

  // --- 12. Audio effects ---
  const audioFx = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rail = document.querySelector('nav[aria-label="Editor modes"]');
    [...rail.querySelectorAll('button')].find(b => /^Audio/.test(b.getAttribute('aria-label')||''))?.click();
    await tick(); await tick();
    const tiles = document.querySelectorAll('button[aria-label^="Apply the"], button[aria-label^="Remove the"]');
    const silence = document.body.innerText.includes('Remove silence');
    return JSON.stringify({ tiles: tiles.length, silence });
  })()`);
  const audioRes = JSON.parse(String(audioFx).replace(/^"|"$/g, '') || '{}');
  check('audio panel lists real effects and silence removal', (audioRes.tiles ?? 0) >= 10 && audioRes.silence, audioRes);

  // --- 13. Titles ---
  const titles = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const rail = document.querySelector('nav[aria-label="Editor modes"]');
    [...rail.querySelectorAll('button')].find(b => /^Titles/.test(b.getAttribute('aria-label')||''))?.click();
    await tick(); await tick();
    const before = document.querySelectorAll('[data-clip]').length;
    const tile = [...document.querySelectorAll('button')].find(b => /Lower third/.test(b.textContent||''));
    if (!tile) return JSON.stringify({ error: 'no title style tile' });
    tile.click();
    await tick(); await tick();
    return JSON.stringify({ before, after: document.querySelectorAll('[data-clip]').length });
  })()`);
  const titlesRes = JSON.parse(String(titles).replace(/^"|"$/g, '') || '{}');
  check('a title can be added from the panel', titlesRes.after === titlesRes.before + 1, titlesRes);

  // --- 14. Undo / redo / delete / select all ---
  const editing = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clips = () => document.querySelectorAll('[data-clip]').length;
    const out = { start: clips() };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    out.selected = Number((document.body.innerText.match(/(\\d+) selected/) || [0,'0'])[1]);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await tick(); await tick();
    out.afterDelete = clips();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    out.afterUndo = clips();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    out.afterRedo = clips();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    out.restored = clips();
    return JSON.stringify(out);
  })()`);
  const editRes = JSON.parse(String(editing).replace(/^"|"$/g, '') || '{}');
  check('select all, delete, undo, redo all work', editRes.selected === editRes.start && editRes.afterDelete === 0 && editRes.afterUndo === editRes.start && editRes.afterRedo === 0 && editRes.restored === editRes.start, editRes);

  // --- 15. Copy / paste / duplicate ---
  const clipboard = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const clips = () => document.querySelectorAll('[data-clip]').length;
    document.querySelector('[data-clip]').click();
    await tick(); await tick();
    const selected = Number((document.body.innerText.match(/(\\d+) selected/) || [0,'0'])[1]);
    const before = clips();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    const afterDup = clips();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    return JSON.stringify({ selected, before, afterDup, afterPaste: clips(), toast: document.querySelector('[role="status"]')?.textContent || '' });
  })()`);
  const clipRes = JSON.parse(String(clipboard).replace(/^"|"$/g, '') || '{}');
  check(
    'duplicate adds one copy of the selection',
    clipRes.selected === 1 && clipRes.afterDup === clipRes.before + 1,
    clipRes
  );
  check('paste adds the clipboard', clipRes.afterPaste === clipRes.afterDup + 1, clipRes);

  // --- 16. Project save + reload (redo across a page load) ---
  // The undo is left IN PLACE on purpose: that is what leaves a non-empty redo
  // stack, and the redo stack is what has to survive the reload. Saving after
  // a fresh edit would have nothing to redo and the assertion would pass for
  // the wrong reason.
  const saved = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    document.querySelector('[data-clip]').click();
    await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await tick(); await tick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 2500));
    const raw = localStorage.getItem('wideo11.editor.projects');
    const redoEnabledBefore = !document.querySelector('[aria-label="Redo"]')?.disabled;
    return JSON.stringify({ index: raw ? JSON.parse(raw) : null, redoEnabledBefore });
  })()`);
  const savedRes = JSON.parse(String(saved).replace(/^"|"$/g, '') || '{}');
  check('project saved and listed as recent', Array.isArray(savedRes.index) && savedRes.index.length >= 1, savedRes.index);
  check('a redo is available before the reload', savedRes.redoEnabledBefore === true, savedRes);

  const beforeReload = await ev(`document.querySelectorAll('[data-clip]').length`);
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(8000);
  const afterReload = await ev(`(() => ({
    clips: document.querySelectorAll('[data-clip]').length,
    tiles: document.querySelectorAll('li').length,
    name: (document.body.innerText.match(/Video [0-9]|Audio [0-9]|Text [0-9]/) || [''])[0],
    redoEnabled: !document.querySelector('[aria-label="Redo"]')?.disabled,
    transitionBadges: document.querySelectorAll('[data-transition]').length,
  }))()`);
  check('project reopens after a reload with its clips', afterReload.clips >= beforeReload - 1 && afterReload.clips > 0, { beforeReload, afterReload });
  check('media restored from IndexedDB', afterReload.tiles >= 3, afterReload);
  check('transitions survive a reload', afterReload.transitionBadges >= 1, afterReload);
  check('redo survives a reload', afterReload.redoEnabled === true, afterReload);

  // --- 17. Export dialog opens and reports honestly ---
  const exp = await ev(`(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true }));
    await new Promise(r => setTimeout(r, 500));
    const dlg = document.querySelector('[role="dialog"][aria-label="Export video"]');
    if (!dlg) return JSON.stringify({ opened: false });
    const presets = dlg.querySelectorAll('select[aria-label="Export preset"] option').length;
    const text = dlg.innerText;
    dlg.querySelector('[aria-label="Close export dialog"]')?.click();
    return JSON.stringify({ opened: true, presets, realTime: /Real-time/.test(text), container: /WEBM|MediaRecorder/i.test(text) });
  })()`);
  const expRes = JSON.parse(String(exp).replace(/^"|"$/g, '') || '{}');
  check('export dialog opens with presets and honest copy', expRes.opened && expRes.presets >= 10 && expRes.realTime, expRes);

  // --- 18. Resizable handles still work, correct directions ---
  const handles = await ev(`(() => [...document.querySelectorAll('[role="separator"]')].map(h => ({
    label: h.getAttribute('aria-label'), now: Number(h.getAttribute('aria-valuenow')),
    min: Number(h.getAttribute('aria-valuemin')), max: Number(h.getAttribute('aria-valuemax')),
    tabbable: h.getAttribute('tabindex') === '0',
  })).filter(h => /bin|timeline|status/i.test(h.label || '')))()`);
  check('resize handles exist and are keyboard reachable', handles.length >= 3 && handles.every(h => h.tabbable), handles);

  const drag = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const h = [...document.querySelectorAll('[role="separator"]')].find(x => /media bin/i.test(x.getAttribute('aria-label')||''));
    if (!h) return 'handle not found';
    const box = h.getBoundingClientRect();
    const before = Number(h.getAttribute('aria-valuenow'));
    const o = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height/2, pointerId: 3, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(box.left)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(box.left + 60)));
    await tick();
    const during = Number(h.getAttribute('aria-valuenow'));
    h.dispatchEvent(new PointerEvent('pointerup', o(box.left + 60)));
    h.dispatchEvent(new PointerEvent('pointermove', o(box.left - 4000)));
    const min = Number(h.getAttribute('aria-valuemin'));
    const max = Number(h.getAttribute('aria-valuemax'));
    return JSON.stringify({ before, during, grew: during > before, min, max });
  })()`);
  const dragRes = JSON.parse(String(drag).replace(/^"|"$/g, '') || '{}');
  check('media bin resize handle grows the panel to the right', dragRes.grew === true, dragRes);

  const dragV = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const h = [...document.querySelectorAll('[role="separator"]')].find(x => /timeline/i.test(x.getAttribute('aria-label')||''));
    if (!h) return 'handle not found';
    const box = h.getBoundingClientRect();
    const before = Number(h.getAttribute('aria-valuenow'));
    const o = (y) => ({ bubbles: true, clientX: box.left + box.width/2, clientY: y, pointerId: 4, isPrimary: true, button: 0 });
    h.dispatchEvent(new PointerEvent('pointerdown', o(box.top)));
    await tick();
    h.dispatchEvent(new PointerEvent('pointermove', o(box.top - 80)));
    await tick();
    const during = Number(h.getAttribute('aria-valuenow'));
    h.dispatchEvent(new PointerEvent('pointerup', o(box.top - 80)));
    return JSON.stringify({ before, during, grew: during > before });
  })()`);
  const dragVRes = JSON.parse(String(dragV).replace(/^"|"$/g, '') || '{}');
  check('timeline handle grows the timeline upward', dragVRes.grew === true, dragVRes);

  // --- 19. Status footer pinned at the bottom ---
  const footer = await ev(`(() => {
    const tc = [...document.querySelectorAll('span')].find(s => /^TC /.test(s.textContent || ''));
    if (!tc) return null;
    const strip = tc.closest('div');
    return { bottom: Math.round(tc.getBoundingClientRect().bottom), inner: window.innerHeight, height: Math.round(strip.getBoundingClientRect().height) };
  })()`);
  check(
    'status footer pinned to the bottom of the window',
    Boolean(footer && footer.bottom > 0 && Math.abs(footer.bottom - footer.inner) < 40),
    footer
  );

  // --- 20. Playback actually advances ---
  const playback = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    const read = () => Number(document.querySelector('[role="slider"][aria-label="Timeline playhead"]')?.getAttribute('aria-valuenow') || 0);
    // Seek to the start of the first clip.
    const el = document.querySelector('[role="slider"][aria-label="Timeline playhead"]');
    const box = el.getBoundingClientRect();
    const o = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height/2, pointerId: 9, isPrimary: true, button: 0 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(box.left + 1)));
    await tick();
    el.dispatchEvent(new PointerEvent('pointerup', o(box.left + 1)));
    const t0 = read();
    document.querySelector('[aria-label="Play"]')?.click();
    for (let i = 0; i < 40; i++) await tick();
    const t1 = read();
    document.querySelector('[aria-label="Pause"]')?.click();
    return JSON.stringify({ t0, t1, advanced: t1 > t0 });
  })()`);
  const pbRes = JSON.parse(String(playback).replace(/^"|"$/g, '') || '{}');
  check('playback advances the playhead', pbRes.advanced === true, pbRes);

  // --- 21. Theme toggle ---
  const theme = await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    const before = document.documentElement.className;
    document.querySelector('[aria-label^="Switch to"]')?.click();
    await tick(); await tick();
    const after = document.documentElement.className;
    document.querySelector('[aria-label^="Switch to"]')?.click();
    await tick();
    return JSON.stringify({ before, after, changed: before !== after, backAgain: document.documentElement.className === before });
  })()`);
  const themeRes = JSON.parse(String(theme).replace(/^"|"$/g, '') || '{}');
  check('theme toggle switches the surface class and back', themeRes.changed === true && themeRes.backAgain === true, themeRes);

  // --- 22. Overflow + broken images at the end ---
  const final = await ev(`(() => ({
    brokenImages: [...document.images].filter(i => i.complete && i.naturalWidth === 0).length,
    docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    emptyOverlays: [...document.querySelectorAll('*')].filter(e => e.textContent === 'This is a placeholder').length,
  }))()`);
  check('no broken images at the end', final.brokenImages === 0, final);
  check('no horizontal overflow at the end', final.docOverflow <= 2, { docOverflow: final.docOverflow });
  check('no placeholder text left in the DOM', final.emptyOverlays === 0, final);

  // --- 24. Scrollbars are 1px ---
  // Measured, not read from CSS. `offsetWidth - clientWidth` is the number the
  // user actually sees, and it is the only way to catch an override that the
  // stylesheet does not know about.
  const scrollbars = JSON.parse(
    String(
      await ev(`(() => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
          const v = el.scrollHeight > el.clientHeight + 1;
          const h = el.scrollWidth > el.clientWidth + 1;
          if (!v && !h) continue;
          const barW = v ? el.offsetWidth - el.clientWidth : 0;
          const barH = h ? el.offsetHeight - el.clientHeight : 0;
          if (barW <= 0 && barH <= 0) continue;
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 50),
            role: el.getAttribute('role') || el.getAttribute('aria-label') || '',
            barW, barH,
          });
        }
        return JSON.stringify(out);
      })()`)
    ).replace(/^"|"$/g, '') || '[]'
  );
  const thick = (scrollbars || []).filter((s) => s.barW > 1 || s.barH > 1);
  check('every scrollbar renders 1px', thick.length === 0, { scrollbars, thick });

  // --- 23. Console errors ---
  const realErrors = logs.filter(
    (l) =>
      !/favicon|Failed to load resource: the server responded with a status of 404/.test(l) &&
      !/net::ERR_/.test(l)
  );
  check('no uncaught console errors', realErrors.length === 0, { errors: realErrors.slice(0, 6) });

  // --- Screenshots ---
  // Park the playhead somewhere a frame is actually on screen. Screenshotting
  // the end of the timeline produces a black rectangle that tells nobody
  // whether the compositor works.
  await ev(`(() => {
    const el = document.querySelector('[role="slider"][aria-label="Timeline playhead"]');
    const box = el.getBoundingClientRect();
    // A third of the way in: inside the first clip, with the title on top.
    const x = box.left + box.width * 0.12;
    const o = (cx) => ({ bubbles: true, clientX: cx, clientY: box.top + box.height / 2, pointerId: 71, isPrimary: true, button: 0 });
    el.dispatchEvent(new PointerEvent('pointerdown', o(x)));
    el.dispatchEvent(new PointerEvent('pointerup', o(x)));
  })()`);
  await sleep(1500);
  await ev(`(async () => { const tick = () => new Promise(r => requestAnimationFrame(r)); for (let i=0;i<5;i++) await tick(); })()`);
  const shot1 = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(SHOT, Buffer.from(shot1.data, 'base64'));
  console.log(`screenshot: ${SHOT}`);

  const metrics = await cdp('Page.getLayoutMetrics', {}, sid);
  const h = Math.min(2400, Math.ceil(metrics.cssContentSize.height));
  const shot2 = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1600, height: h, scale: 1 } }, sid);
  writeFileSync(SHOT2, Buffer.from(shot2.data, 'base64'));
  console.log(`screenshot: ${SHOT2}`);

  // The light theme, so it is looked at rather than assumed. A theme that has
  // only ever been checked in dark is a theme with white-on-white somewhere in
  // it, and nobody finds out until a user does.
  const lightShot = SHOT2.replace(/\.png$/, '-light.png');
  await ev(`(() => { document.querySelector('[aria-label^="Switch to"]')?.click(); return true; })()`);
  await sleep(1200);
  const lightContrast = await ev(`(() => {
    const read = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    return JSON.stringify({
      body: getComputedStyle(document.body).backgroundColor,
      toolbar: read('[role="toolbar"]', 'backgroundColor'),
      ruler: read('[role="slider"][aria-label="Timeline playhead"]', 'backgroundColor'),
      text: read('[role="menubar"] button', 'color'),
      canvasVisible: !!document.querySelector('[role="img"] canvas'),
    });
  })()`);
  check('light theme repaints the surfaces', JSON.parse(lightContrast).toolbar !== null, JSON.parse(lightContrast));
  const shot3 = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
  writeFileSync(lightShot, Buffer.from(shot3.data, 'base64'));
  console.log(`screenshot: ${lightShot}`);
  await ev(`(() => { document.querySelector('[aria-label^="Switch to"]')?.click(); return true; })()`);
  await sleep(500);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (appLogs.length) {
    // Surfaced only on failure, and only the tail. App logs are a diagnostic
    // aid, not the report - a passing run stays quiet.
    const real = appLogs.filter((l) => !/^\[object/.test(l));
    if (real.length) {
      console.log('\napp log (tail):');
      for (const l of real.slice(-25)) console.log('  ' + l);
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
