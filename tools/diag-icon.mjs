// Why does superadmin's icon.svg parse to ZERO animation elements when admin's
// parses to one, from files written the same way?
//
// The difference between PASS and FAIL here is the entire question, so this prints
// the parser's own complaint instead of inferring it.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9600 + Math.floor(Math.random() * 150);
const profile = mkdtempSync(join(tmpdir(), 'diag-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank',
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
    setTimeout(() => rej(new Error(`${method}: timeout`)), 30000);
  });
}

try {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  const { targetId } = await cdp(ws, 'Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await cdp(ws, 'Runtime.enable', {}, sessionId);
  await cdp(ws, 'Page.navigate', { url: 'http://localhost:3008/login' }, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  for (const port of [3008, 3004]) {
    const r = await cdp(ws, 'Runtime.evaluate', {
      expression: `(async () => {
        const res = await fetch('http://localhost:${port}/icon.svg');
        const text = await res.text();
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const err = doc.querySelector('parsererror');
        return JSON.stringify({
          port: ${port},
          bytes: text.length,
          rootNode: doc.documentElement ? doc.documentElement.nodeName : null,
          parserError: err ? err.textContent.slice(0, 300) : null,
          animateTransform: doc.querySelectorAll('animateTransform').length,
          svgEls: doc.querySelectorAll('svg').length,
          head: text.slice(0, 90)
        });
      })()`,
      awaitPromise: true, returnByValue: true,
    }, sessionId);
    console.log(JSON.stringify(JSON.parse(r.result.value), null, 2));
    console.log('---');
  }
} catch (e) {
  console.log('ERROR', e.message);
} finally { cleanup(); process.exit(0); }
