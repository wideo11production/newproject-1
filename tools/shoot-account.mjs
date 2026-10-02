#!/usr/bin/env node
// Screenshot the editor's account control, signed in.
//
// A screenshot settles "I can't see the avatar" faster than any assertion: it
// shows the pixels rather than reporting what the DOM claims. Scoped to the
// toolbar's right edge, where the control lives, so the image is legible
// instead of a 2560px strip with a 32px button somewhere in it.
//
// Usage:  node tools/shoot-account.mjs [out.png]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, SESSION_COOKIE } from './harness-session.mjs';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = process.argv[2] ?? 'account.png';

const profile = mkdtempSync(join(tmpdir(), 've-shot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('no debug url')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = /ws:\/\/[^\s]+/.exec(buf);
    if (m) { clearTimeout(t); resolve(m[0]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params, sessionId }));
  });

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;

await send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

const token = await login();
await send('Network.setCookie', { name: SESSION_COOKIE, value: token, domain: 'localhost', path: '/' }, sessionId);
await send('Page.navigate', { url: 'http://localhost:3002/' }, sessionId);
await new Promise((r) => setTimeout(r, 3000));

const ev = async (expression) => {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return result.result.value;
};

const shot = async (clipName) => {
  const params = { format: 'png' };
  if (clipName === 'menu') {
    const box = await ev(`(() => {
      const b = document.querySelector('button[aria-label^="Account menu for"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: r.right - 260, y: Math.max(0, r.top - 8), width: 260, height: 300 });
    })()`);
    if (box) params.clip = { ...JSON.parse(box), scale: 2 };
  } else {
    const box = await ev(`(() => {
      const b = document.querySelector('button[aria-label^="Account menu for"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0, r.right - 300), y: Math.max(0, r.top - 10), width: 300, height: 60 });
    })()`);
    if (box) params.clip = { ...JSON.parse(box), scale: 3 };
  }
  const { result } = await send('Page.captureScreenshot', params, sessionId);
  return result.data;
};

// 1. the control itself
writeFileSync(OUT, Buffer.from(await shot('avatar'), 'base64'));
console.log(`wrote ${OUT}`);

// 2. the open menu, so the dashboard link is visible too
await ev(`document.querySelector('button[aria-label^="Account menu for"]').click()`);
await new Promise((r) => setTimeout(r, 300));
const menuFile = OUT.replace(/\.png$/, '-menu.png');
writeFileSync(menuFile, Buffer.from(await shot('menu'), 'base64'));
console.log(`wrote ${menuFile}`);

console.log(await ev(`(() => {
  const b = document.querySelector('button[aria-label^="Account menu for"]');
  const cs = b ? getComputedStyle(b) : null;
  return JSON.stringify({
    found: !!b,
    text: b ? b.innerText.trim() : null,
    box: b ? JSON.parse(JSON.stringify(b.getBoundingClientRect())) : null,
    // These are the properties that decide whether it is actually PAINTED.
    display: cs?.display, visibility: cs?.visibility, opacity: cs?.opacity,
    boxShadow: cs?.boxShadow, color: cs?.color, background: cs?.backgroundColor,
  }, null, 0);
})()`));

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
