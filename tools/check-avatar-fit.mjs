// Does the account-menu avatar stay INSIDE its box, and stay small?
//
// -----------------------------------------------------------------------------
// WHY THIS IS MEASURED, NOT EYEBALLED
// -----------------------------------------------------------------------------
//
// The report was "the avatar breaks out of the lines". That is a GEOMETRY claim,
// and geometry is measurable: `getBoundingClientRect()` on the avatar and on the
// toolbar gives four numbers that answer it exactly.
//
// A screenshot cannot answer it. The reported one was taken at roughly 2x zoom,
// where EVERYTHING is large — the menu text, the help icon, the avatar — and a
// reader cannot tell "the avatar is oversized" from "the whole capture is
// magnified". This asserts the relationship instead: the avatar's box against the
// BAR's box, in CSS pixels, at whatever zoom the browser happens to be at.
//
// The four assertions, and what each would mean if it failed:
//
//	avatar fits inside the bar vertically  -> it is not overflowing
//	avatar height <= 32px                  -> it is not oversized
//	the status dot stays inside the avatar -> the green dot is not the escapee
//	the dot scales with the avatar        -> they were sized for different circles
//
// That last one is the actual bug found in review: the dot was `h-2.5` with a
// `border-2` for a 32px circle. When the avatar became 28px, the dot kept its old
// size and its inset, so it poked outside the button — which reads as "the avatar is
// bursting out" when the avatar itself was fine.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9450 + Math.floor(Math.random() * 40);
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

const profile = mkdtempSync(join(tmpdir(), 'avatar-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars',
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

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'http://localhost:3000/auth/login' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Page.enable', {}, sessionId);
  await cdp(ws, 'Runtime.enable', {}, sessionId);
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
  await new Promise((r) => setTimeout(r, 9000));

  // Open the account menu, since that is the state the screenshot was taken in.
  const opened = await evaluate(ws, sessionId, `(() => {
    const btn = document.querySelector('button[aria-label^="Account menu for"]');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('account menu button found and opened', opened, '');
  await new Promise((r) => setTimeout(r, 900));

  const geom = await evaluate(ws, sessionId, `(() => {
    // TARGET THE AVATAR SPECIFICALLY, not "the first menu button".
    //
    // The first version of this probe used
    //   document.querySelector('button[aria-haspopup="menu"]')
    // and measured 20px — which is h-5, not the h-7 this fix sets. The editor has
    // several menu controls, and querySelector returns the first in DOCUMENT
    // order, so it was measuring a different button and cheerfully reporting it as
    // the avatar.
    //
    // The avatar is identified by its own label, which every avatar in this app
    // carries: "Account menu for <email>". Two of them and the assertion below
    // should FAIL rather than silently pick one.
    const buttons = Array.from(document.querySelectorAll('button[aria-label^="Account menu for"]'));
    const btn = buttons[0];
    if (!btn) return JSON.stringify({ found: false, menuButtons: document.querySelectorAll('button[aria-haspopup="menu"]').length });
    if (buttons.length > 1) return JSON.stringify({ found: false, multiple: buttons.length });

    const a = btn.getBoundingClientRect();

    // The status dot is the avatar's only absolutely-positioned child.
    const dot = Array.from(btn.children).find(c => getComputedStyle(c).position === 'absolute');
    const d = dot ? dot.getBoundingClientRect() : null;

    // The bar the avatar lives in: the nearest ancestor with a bottom border.
    let bar = btn.parentElement;
    while (bar && getComputedStyle(bar).borderBottomWidth === '0px') bar = bar.parentElement;
    const r = bar ? bar.getBoundingClientRect() : null;

    return JSON.stringify({
      found: true,
      cls: btn.className,
      avatar: { top: a.top, bottom: a.bottom, left: a.left, right: a.right, w: a.width, h: a.height },
      dot: d ? { top: d.top, bottom: d.bottom, right: d.right, w: d.width, h: d.height } : null,
      dotFound: !!dot,
      bar: r ? { top: r.top, bottom: r.bottom, h: r.height } : null,
      devicePixelRatio: window.devicePixelRatio
    });
  })()`);
  const g = JSON.parse(geom);

  if (!g.found) {
    check('avatar is present', false, 'no button[aria-haspopup=menu] — the editor is gated?');
  } else {
    const { avatar: a, dot: d, bar } = g;
    const eps = 0.5; // sub-pixel tolerance; getBoundingClientRect returns fractions

    check('avatar is not oversized', a.h <= 32.5,
      `${a.h.toFixed(1)}px tall (was h-8 = 32, now h-7 = 28)`);

    if (bar) {
      const insideTop = a.top >= bar.top - eps;
      const insideBottom = a.bottom <= bar.bottom + eps;
      check('avatar fits INSIDE the toolbar, not through it', insideTop && insideBottom,
        `avatar ${a.top.toFixed(1)}–${a.bottom.toFixed(1)}  bar ${bar.top.toFixed(1)}–${bar.bottom.toFixed(1)}` +
        `  overflow: ${!insideTop ? 'TOP ' : ''}${!insideBottom ? 'BOTTOM' : ''}`);
    } else {
      check('found the toolbar to compare against', false, 'no ancestor with a bottom border');
    }

    if (d) {
      const dotInside = d.right <= a.right + eps && d.bottom <= a.bottom + eps;
      check('the status dot stays INSIDE the avatar', dotInside,
        `dot right ${d.right.toFixed(1)} vs avatar right ${a.right.toFixed(1)}; ` +
        `dot bottom ${d.bottom.toFixed(1)} vs avatar bottom ${a.bottom.toFixed(1)}`);
      check('the dot scales WITH the avatar', d.w <= a.w * 0.4,
        `dot ${d.w.toFixed(1)}px on a ${a.w.toFixed(1)}px avatar`);
    } else {
      check('status dot found', false, 'no absolutely-positioned child');
    }

    console.log(`  (devicePixelRatio=${g.devicePixelRatio} — the reported screenshot was zoomed,` +
      ` which is why everything in it looked oversized)`);
  }

  const shot = await cdp(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(join(OUT, 'editor-avatar-fixed.png'), Buffer.from(shot.data, 'base64'));
} catch (err) {
  check('harness completed', false, String(err.message ?? err));
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log('='.repeat(70));
  console.log(`${results.length - failed}/${results.length} passed`);
  console.log('screenshot -> screenshots/editor-avatar-fixed.png');
  cleanup();
  process.exit(failed === 0 ? 0 : 1);
}
