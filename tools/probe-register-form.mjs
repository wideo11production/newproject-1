// Why does the register form's submit do nothing?
//
// The backend is proven good - register and login both return tokens through
// the API. So this is about the FORM: whether its button is enabled, whether it
// is inside a <form>, and whether clicking it fires a request at all.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.argv[2] ?? 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'fm-'));
const PORT = 9960 + Math.floor(Math.random() * 30);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const EMAIL = `form${stamp}@test.local`;

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
  await cdp('Network.enable', {}, sid);
  const net = [];
  ws.addEventListener('message', (e) => {
    const x = JSON.parse(e.data);
    if (x.method === 'Network.requestWillBeSent' && /auth/i.test(x.params.request.url)) {
      net.push(`${x.params.request.method} ${x.params.request.url.replace('http://localhost:3000', '')}`);
    }
  });

  const ev = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return JSON.stringify({ __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
    return r.result.value;
  };
  const g = (body) => ev(`(async () => {
    const tick = () => new Promise(r => requestAnimationFrame(r));
    ${body}
    for (let i = 0; i < 6; i++) await tick();
    return JSON.stringify(__out);
  })()`);
  const j = (v) => { try { return JSON.parse(String(v)); } catch { return {}; } };

  await cdp('Page.navigate', { url: `${WEB}/auth/register` }, sid);
  await sleep(5000);

  console.log('shape:', await g(`
    const form = document.querySelector('form');
    const btns = [...document.querySelectorAll('button')].map(b => ({
      type: b.getAttribute('type'), text: (b.textContent||'').trim().slice(0,24),
      disabled: b.disabled, insideForm: !!b.closest('form'),
    }));
    __out = { hasForm: !!form, fields: [...document.querySelectorAll('input')].map(i => ({ type: i.type, name: i.name, ph: i.placeholder })), btns };
  `));

  console.log('fill:', await g(`
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const hit = (i) => i.type === 'text' || i.type === 'email' || i.type === 'password' || i.type === 'checkbox';
    let textN = 0;
    for (const i of document.querySelectorAll('input')) {
      if (i.type === 'checkbox') { if (!i.checked) i.click(); await tick(); continue; }
      if (i.type !== 'text' && i.type !== 'email') continue;
      const v = i.type === 'email' ? '${EMAIL}' : 'formuser${stamp}';
      nativeInput.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new Event('change', { bubbles: true }));
      textN++;
    }
    for (const p of document.querySelectorAll('input[type="password"]')) {
      nativeInput.call(p, 'Str0ng-Passw0rd!');
      p.dispatchEvent(new Event('input', { bubbles: true }));
    }
    __out = { textFields: textN };
  `));
  void setterName;

  const before = await g(`
    const b = [...document.querySelectorAll('button')].find(x => /create account/i.test(x.textContent || ''));
    __out = b ? { disabled: b.disabled, type: b.getAttribute('type'), insideForm: !!b.closest('form') } : { missing: true };
  `);
  console.log('submit button:', JSON.stringify(j(before)));

  await g(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /create account/i.test(x.textContent || ''));
    if (b) { b.removeAttribute('disabled'); b.click(); }
  })();`);
  await sleep(6000);
  console.log('requests seen:', JSON.stringify(net));
  console.log('landed on:', (await cdp('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sid)).result.value);
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
const setterName = null;
void setterName;