// Measure the ACTUAL rendered scrollbar thickness of every scrollable element
// on a page. `offsetWidth - clientWidth` is the number the user sees; reading
// the CSS alone would not catch an override.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'sb-'));
const PORT = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, sid;
try {
  let u;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) { u = (await r.json()).webSocketDebuggerUrl; break; }
    } catch { /* waiting */ }
    await sleep(250);
  }
  ws = new globalThis.WebSocket(u);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = (m, p = {}, s) => new Promise((rs, rj) => {
    const id = Math.floor(Math.random() * 1e9);
    const h = (e) => {
      const x = JSON.parse(e.data);
      if (x.id === id) { ws.removeEventListener('message', h); x.error ? rj(new Error(x.error.message)) : rs(x.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
  });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(9000);

  const r = await cdp('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const vScroll = el.scrollHeight > el.clientHeight + 1;
        const hScroll = el.scrollWidth > el.clientWidth + 1;
        if (!vScroll && !hScroll) continue;
        const w = el.offsetWidth - el.clientWidth;
        const h = el.offsetHeight - el.clientHeight;
        const box = el.getBoundingClientRect();
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          role: el.getAttribute('role') || el.getAttribute('aria-label') || '',
          v: vScroll, h: hScroll,
          barW: vScroll ? w : 0,
          barH: hScroll ? h : 0,
          at: Math.round(box.left) + ',' + Math.round(box.top),
        });
      }
      const root = getComputedStyle(document.documentElement);
      return JSON.stringify({
        rootScrollbarWidth: root.scrollbarWidth,
        rootScrollbarColor: root.scrollbarColor,
        elements: out,
      }, null, 1);
    })()`,
  }, sid);
  console.log(r.result.value);
} catch (e) {
  console.error('failed:', e.message);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* temp */ }
}
