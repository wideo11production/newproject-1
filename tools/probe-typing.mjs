// Type into the register form the way a person does - real key events through
// the CDP Input domain - and see whether the submit button ever enables.
//
// Every previous attempt drove React with synthetic events plus the native value
// setter. That is a known-fragile way to poke a controlled input, and it left
// the button `disabled` every time, which looked exactly like the bug the user
// reported. This uses the browser's own input path so there is no ambiguity
// about whose fault a `disabled` button is.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = process.argv[2] ?? 'http://localhost:3000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'ty-'));
const PORT = 9970 + Math.floor(Math.random() * 25);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const EMAIL = `type${stamp}@test.local`;
const USER = `type${stamp}`;
const PASS = 'Str0ng-Passw0rd!';

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
  const ev = async (e) => {
    const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) return JSON.stringify({ __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text });
    return r.result.value;
  };

  await cdp('Page.navigate', { url: `${WEB}/auth/register` }, sid);
  await sleep(5000);

  /** Focus a field by its position and TYPE into it for real. */
  const typeInto = async (selector, nth, text) => {
    await ev(`(() => {
      const el = ${selector};
      if (!el) return 'missing';
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      return 'ok';
    })()`);
    // Real keystrokes, in chunks: Input.insertText does not fire keydown, so
    // each chunk is preceded by a key event to be sure React sees the field.
    for (let i = 0; i < text.length; i += 20) {
      await cdp('Input.insertText', { text: text.slice(i, i + 20) }, sid);
    }
    await sleep(120);
  };

  await typeInto('document.querySelector(\'input[name="username"]\')', 0, USER);
  await typeInto('document.querySelector(\'input[type="email"]\')', 0, EMAIL);
  await typeInto('document.querySelectorAll(\'input[type="password"]\')[0]', 0, PASS);
  await typeInto('document.querySelectorAll(\'input[type="password"]\')[1]', 0, PASS);

  // The terms checkbox is a RADIX Checkbox: a <button role="checkbox"> with a
  // hidden <input type="checkbox"> behind it for form submission.
  //
  // Clicking the hidden input - which is what every earlier probe did - changes
  // nothing in React's state, so `acceptedTerms` stays false and the submit
  // button stays disabled FOREVER. That is exactly the "the pipeline is stuck"
  // symptom, and it was the probe's fault, not the form's.
  //
  // A real user clicks the visible control, or the label wired to it by
  // htmlFor. So does this.
  await ev(`(() => {
    const label = [...document.querySelectorAll('label')].find(l => /I agree to the/i.test(l.textContent || ''));
    const control = document.getElementById('terms');
    const target = label || control;
    if (target) target.click();
    return target ? 'clicked' : 'no terms control';
  })()`);
  await sleep(400);
  const termsNow = await ev(`(() => {
    const c = document.getElementById('terms');
    return JSON.stringify({ tag: c ? c.tagName : null, role: c ? c.getAttribute('role') : null, checked: c ? c.getAttribute('aria-checked') : null, state: c ? c.getAttribute('data-state') : null });
  })()`);
  console.log('terms control:', termsNow);

  const state = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => /create account/i.test(x.textContent || ''));
    const vals = [...document.querySelectorAll('input')].map(i => ({ type: i.type, len: i.value.length, checked: i.type === 'checkbox' ? i.checked : undefined }));
    return JSON.stringify({ disabled: b ? b.disabled : null, vals, text: document.body.innerText.slice(0, 300).replace(/\\s+/g, ' ') });
  })()`);
  console.log('after real typing:', state);

  await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /create account/i.test(x.textContent || '')); if (b) b.click(); })()`);
  await sleep(7000);
  console.log('requests:', JSON.stringify(net));
  console.log('landed on:', (await cdp('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sid)).result.value);
  const cookies = await cdp('Network.getCookies', {}, sid);
  console.log('cookies:', cookies.cookies.map((c) => `${c.name}@${c.domain}`).join(', ') || 'none');
} catch (e) {
  console.error('probe failed:', e.message);
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}