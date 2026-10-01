#!/usr/bin/env node
// Read the real rendered text of a page in a real browser.
//
// SSR HTML is not evidence for a client component: `useSearchParams` forces
// these pages to render after hydration, so the server response is the
// Suspense fallback and says nothing about what the user actually sees. This
// drives a headless Chrome, waits for hydration, and reads the DOM.
//
// Usage:  node tools/read-dom.mjs <url> [substring-to-require]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2];
const NEEDLE = process.argv[3] ?? '';
if (!URL) {
  console.error('usage: node tools/read-dom.mjs <url> [substring]');
  process.exit(2);
}

// Chrome is not on PATH on a normal Windows install, so resolve the same
// absolute path the other browser tools in this repo use. CHROME_BIN lets a
// machine with it elsewhere override without editing the file.
const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const profile = mkdtempSync(join(tmpdir(), 've-dom-'));
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
  const t = setTimeout(() => reject(new Error('chrome did not report a debug url')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d.toString();
    const m = /ws:\/\/[^\s]+/.exec(buf);
    if (m) {
      clearTimeout(t);
      resolve(m[0]);
    }
  });
});

const { WebSocket } = await import('node:worker_threads').then(() => ({ WebSocket: globalThis.WebSocket }));
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params, sessionId }));
  });

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: URL }, sessionId);

// Hydration + the client's own fetch both need a moment. 1.2s is generous for a
// static page and still far below anything that would mask a real hang.
await new Promise((r) => setTimeout(r, 1200));

const { result } = await send(
  'Runtime.evaluate',
  {
    expression: `JSON.stringify({
      text: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')].map((a) => ({
        label: a.textContent.trim().slice(0, 60),
        href: a.getAttribute('href'),
      })),
    })`,
    returnByValue: true,
  },
  sessionId
);
const parsed = JSON.parse(result.result.value ?? '{}');
const text = parsed.text ?? '';

console.log('---------- rendered text ----------');
console.log(text.trim());
console.log('---------- links ----------');
for (const l of parsed.links ?? []) console.log(`  ${l.label}  ->  ${l.href}`);
console.log('---------- end ----------');

if (NEEDLE) {
  const ok = text.includes(NEEDLE);
  console.log(`\ncontains ${JSON.stringify(NEEDLE)}: ${ok ? 'YES' : 'NO'}`);
  if (!ok) process.exitCode = 1;
}

ws.close();
chrome.kill();
// Chrome holds its profile for a moment after SIGTERM on Windows, so a
// synchronous delete races it and throws EPERM. Retrying briefly is enough.
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir, harmless */ }
