#!/usr/bin/env node
// Load a URL in headless Chrome and print every console message and page
// error, unfiltered. Used to read a minified React error's real text by
// pointing it at a dev server, where React is not minified.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:3010/';
const WAIT = Number(process.argv[3] ?? 9000);
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'probe-'));
const PORT = 9800 + Math.floor(Math.random() * 90);
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
  await cdp('Log.enable', {}, sid);
  await cdp('Page.enable', {}, sid);
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Log.entryAdded') {
      const en = x.params.entry;
      console.log(`[${en.level}] ${en.text}`);
    }
    if (x.method === 'Runtime.consoleAPICalled') {
      const text = (x.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      console.log(`[console.${x.params.type}] ${text}`);
    }
    if (x.method === 'Runtime.exceptionThrown') {
      console.log(`[exception] ${x.params.exceptionDetails.exception?.description ?? x.params.exceptionDetails.text}`);
    }
  });
  await cdp('Page.navigate', { url: URL }, sid);
  await sleep(WAIT);
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* temp */ }
}
