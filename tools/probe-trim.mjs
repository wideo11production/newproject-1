// Focused probe: import one file, add a clip, drag its trim handle, and report
// what happened at every step. The full suite's later failures all cascade
// from this one gesture, and a suite cannot tell you WHERE it went wrong.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signIn } from './harness-session.mjs';
import { execFileSync } from 'node:child_process';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'tr-'));
const PORT = 9500 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ffmpeg() {
  for (const p of ['C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe']) if (existsSync(p)) return p;
  try { return execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean); } catch { return null; }
}

const dir = join(userDir, 'f');
mkdirSync(dir, { recursive: true });
const video = join(dir, 'red.mp4');
const ff = ffmpeg();
if (ff) spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: 'ignore' });
else { const b = Buffer.alloc(64 * 1024, 7); spawnSync(process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], Buffer.alloc(65536, 7))`, video]); }

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
  await cdp('Log.enable', {}, sid);
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Runtime.consoleAPICalled') console.log('  [page]', (x.params.args || []).map((a) => a.value ?? a.description).join(' '));
    if (x.method === 'Runtime.exceptionThrown') console.log('  [EXC]', x.params.exceptionDetails.exception?.description?.split('\n')[0]);
    if (x.method === 'Log.entryAdded' && x.params.entry.level === 'error') console.log('  [ERR]', x.params.entry.text.split('\n')[0]);
  });
  const ev = async (e) => {
    const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return 'THREW: ' + (r.exceptionDetails.exception?.description || '').split('\n')[0];
    return r.result.value;
  };

  await signIn(cdp, sid, URL);


  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(7000);

  const { root } = await cdp('DOM.getDocument', {}, sid);
  const { nodeIds } = await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' }, sid);
  await cdp('DOM.setFileInputFiles', { nodeId: nodeIds[nodeIds.length - 1], files: [video] }, sid);
  await sleep(5000);

  console.log('add tile:', await ev(`(() => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => /Add /.test(x.getAttribute('aria-label') || ''));
    if (b) b.click();
    return b ? b.getAttribute('aria-label') : 'none';
  })()`));
  await sleep(1500);

  console.log('clip:', await ev(`(() => {
    const c = document.querySelector('[data-clip]');
    return c ? c.getAttribute('data-frames-start') + ' +' + c.getAttribute('data-frames-length') : 'none';
  })()`));

  console.log('handle present:', await ev(`(() => {
    const c = document.querySelector('[data-clip]');
    const h = c && c.querySelector('[aria-label^="Trim end"]');
    return h ? 'yes w=' + Math.round(h.getBoundingClientRect().width) + ' h=' + Math.round(h.getBoundingClientRect().height) : 'NO';
  })()`));

  await sleep(400);
  console.log('after bare pointerdown, length:', await ev(`document.querySelector('[data-clip]').getAttribute('data-frames-length')`));

  console.log('player bar text:', await ev(`(() => {
    const bar = document.querySelector('[aria-label="Master volume"]')?.closest('div');
    const t = document.body.innerText;
    const i = t.indexOf('TL ');
    return JSON.stringify({ bar: bar ? bar.innerText : 'no bar', around: i >= 0 ? t.slice(i - 30, i + 60) : null, hasTL: i >= 0 });
  })()`));

  console.log('light-theme surfaces + stray outlines:', await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    document.documentElement.classList.add('light');
    for (let i = 0; i < 3; i++) await tick();
    const out = [];
    // Anything painting a bright yellow-green line is a bug: no token in this
    // app is yellow, so it cannot be a colour we chose.
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      for (const prop of ['borderLeftColor', 'borderRightColor', 'borderTopColor', 'outlineColor', 'boxShadow']) {
        const v = cs[prop];
        if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'currentcolor') continue;
        // Escape-free RGB parse: backslashes get eaten inside a template
        // literal, so a regex here silently becomes invalid.
        const nums = v.replace(/[a-z()]/g, '').split(',').map(Number).filter((n) => Number.isFinite(n));
        if (nums.length < 3) continue;
        const [r, g, b] = nums;
        // Yellow-green: green and red clearly above blue.
        if (g > 120 && r > 100 && b < 90) {
          out.push({ prop, value: v, cls: (el.className || '').toString().slice(0, 70), outline: cs.outlineStyle + ' ' + cs.outlineWidth });
        }
      }
    }
    return JSON.stringify({ hits: out.slice(0, 6), total: out.length }, null, 1);
  })()`));

  console.log('edge pixels:', await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    document.documentElement.classList.add('light');
    for (let i = 0; i < 3; i++) await tick();
    // Ask what is actually AT the panel boundaries where a bright line showed
    // up, rather than guessing from the screenshot.
    const pts = [[405, 300], [400, 596], [700, 603], [181, 700], [179, 700], [406, 400]];
    const out = pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { x, y, none: true };
      const cs = getComputedStyle(el);
      return {
        x, y,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 55),
        bL: cs.borderLeftColor + ' ' + cs.borderLeftWidth,
        bR: cs.borderRightColor + ' ' + cs.borderRightWidth,
        bT: cs.borderTopColor + ' ' + cs.borderTopWidth,
        outline: cs.outlineColor + ' ' + cs.outlineStyle + ' ' + cs.outlineWidth,
        shadow: cs.boxShadow.slice(0, 60),
        bg: cs.backgroundColor,
      };
    });
    return JSON.stringify(out, null, 1);
  })()`));

  // Screenshot the dark theme on a clean page so the timeline can be inspected
  // without a dialog covering it.
  await sleep(600);
  {
    const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('timeline-probe.png', Buffer.from(shot.data, 'base64'));
    console.log('screenshot: timeline-probe.png');
  }

  // Read the ACTUAL rendered pixels.
  //
  // Everything else in this probe inspects the DOM, and the DOM says the
  // handles are fully transparent - yet something yellow is on screen at
  // exactly their edges. So take a real screenshot, hand it back INTO the page,
  // draw it to a canvas and read the pixels back.
  //
  // The DOM says one thing and the screen says another, and only the screen
  // settles it. Guessing from a screenshot by eye is what produced three wrong
  // answers in a row here.
  await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    document.documentElement.classList.add('light');
    for (let i = 0; i < 4; i++) await tick();
    return true;
  })()`);
  await sleep(700);
  {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' }, sid);
    const page = (async () => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + SHOT;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]].join(','); };
      return JSON.stringify({ size: img.width + 'x' + img.height, binHandle: at(251, 300), timelineHandle: at(700, 601), footerHandle: at(210, 860), normalPanel: at(600, 300), normalLane: at(700, 700) });
    })();
    const px = await ev(page.replace('SHOT', shot.data));
    console.log('pixels: ' + px);
  }
  console.log('handle paint:', await ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    document.documentElement.classList.add('light');
    for (let i = 0; i < 3; i++) await tick();
    const hs = [...document.querySelectorAll('[role="separator"]')].filter(h => /Resize/i.test(h.getAttribute('aria-label') || ''));
    return JSON.stringify(hs.map(h => {
      const cs = getComputedStyle(h);
      const kids = [...h.children].map(k => {
        const kc = getComputedStyle(k);
        return { cls: (k.className || '').toString().slice(0, 40), bg: kc.backgroundColor, op: kc.opacity };
      });
      return { label: h.getAttribute('aria-label'), bg: cs.backgroundColor, op: cs.opacity, w: cs.width, h: cs.height, kids };
    }), null, 1);
  })()`));

  console.log('--- does the handle carry a React onPointerDown? ---');
  console.log(await ev(`(() => {
    const c = document.querySelector('[data-clip]');
    const h = c.querySelector('[aria-label^="Trim end"]');
    const key = Object.keys(h).find(k => k.startsWith('__reactProps'));
    const props = key ? h[key] : null;
    return JSON.stringify({
      reactKey: key || null,
      hasOnPointerDown: props ? typeof props.onPointerDown === 'function' : false,
      onPointerDownName: props && props.onPointerDown ? String(props.onPointerDown).slice(0, 60) : null,
      clipHasOnPointerDown: !!(c[Object.keys(c).find(k => k.startsWith('__reactProps')) || '']?.onPointerDown),
    });
  })()`));

  console.log('--- drag, reporting between each event ---');
  const step = async (label, body) => {
    const r = await ev(`(() => {
      const c = document.querySelector('[data-clip]');
      const h = c.querySelector('[aria-label^="Trim end"]');
      const hb = h.getBoundingClientRect();
      const o = (x) => ({ bubbles: true, clientX: x, clientY: hb.top + hb.height / 2, pointerId: 7, isPrimary: true, button: 0, cancelable: true });
      ${body}
      // The snap label is written by the MOVE handler only, so its presence
      // proves the handler ran - which separates "the gesture never started"
      // from "the gesture started and the update did not stick".
      const snap = [...document.querySelectorAll('span')].map(s => s.textContent || '').find(t => /snapped to/.test(t)) || null;
      return JSON.stringify({ length: c.getAttribute('data-frames-length'), snap });
    })()`);
    console.log(`  ${label} -> ${r}`);
    await sleep(500);
  };

  await step('after down', `h.dispatchEvent(new PointerEvent('pointerdown', o(hb.right - 2)));`);
  await step('after move 1', `window.dispatchEvent(new PointerEvent('pointermove', o(hb.right - 2 - 60)));`);
  await step('after move 2', `window.dispatchEvent(new PointerEvent('pointermove', o(hb.right - 2 - 60)));`);
  await step('after up', `window.dispatchEvent(new PointerEvent('pointerup', o(hb.right - 2 - 60)));`);

  console.log('settings:', await ev(`(() => JSON.stringify(JSON.parse(localStorage.getItem('wideo11.video-editor.settings.v1')||'{}').snapThresholdPx))()`));
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
