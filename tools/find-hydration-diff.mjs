#!/usr/bin/env node
// Find the hydration mismatch by diffing the server's HTML against the DOM the
// client ends up with.
//
// A production React build only says "Minified React error #418" and re-renders
// from scratch, so the only way to see WHAT did not match is to compare the two
// documents directly: the served HTML is what the server produced, and the live
// DOM after hydration is what the client produced.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:3002/';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'hd-'));
const PORT = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (h) =>
  h
    // React inserts its own Suspense comment markers during hydration, so
    // comments are noise on both sides.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The server string is the whole document; only its body is comparable. */
const bodyOf = (doc) => {
  const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc);
  return m ? m[1] : doc;
};

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
  const r = await cdp('Runtime.evaluate', { expression: 'document.body.innerHTML', returnByValue: true }, sid);
  const client = strip(r.result.value);

  const server = strip(bodyOf(await (await fetch(URL)).text()));
  // The server string is escaped inside the HTML; unescape the few entities
  // that can appear in attributes so the two are comparable.
  const unescape = (s) =>
    s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const a = unescape(server);
  const b = unescape(client);
  console.log(`server=${a.length} client=${b.length}`);
  const min = Math.min(a.length, b.length);
  let i = 0;
  let shown = 0;
  while (i < min && shown < 8) {
    if (a[i] === b[i]) { i++; continue; }
    console.log(`\n--- divergence at ${i} ---`);
    console.log('SERVER: ' + a.slice(Math.max(0, i - 160), i + 260));
    console.log('CLIENT: ' + b.slice(Math.max(0, i - 160), i + 260));
    // Skip past this divergence to find the next independent one.
    let k = 0;
    while (k < 4000 && i + k < min && a[i + k] !== b[i + k]) k++;
    i += k + 1;
    shown++;
  }
  if (i >= min) console.log(`\ncommon prefix ends at ${min} of ${a.length}/${b.length}`);
} catch (e) {
  console.error('failed:', e.message);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch { /* temp */ }
}
