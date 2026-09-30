#!/usr/bin/env node
// End-to-end: register -> verify -> login -> security gate -> /dashboard
//
// This drives the REAL UI, because the bug the user reports is a browser
// navigation loop. Every check so far (curl, status codes, API payloads)
// passed while the flow was broken in the browser, so API-level testing
// cannot find this class of bug. Only driving the actual pages can.
//
// Every step asserts on the URL the browser is ON, plus the visible text -
// not on an HTTP status, because a 200 page can still be the wrong page.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:8085/api/v1';
const stamp = Date.now();
const EMAIL = `e2e${stamp}@wideo11.test`;
const USER = `e2e${stamp}`;
const PASS = 'Str0ng-Passw0rd!';
const PIN = '135792';
const SHOT = process.argv[2] ?? 'e2e-final.png';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDir = mkdtempSync(join(tmpdir(), 'e2e-'));
const PORT = 9800 + Math.floor(Math.random() * 180);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDir}`, '--no-sandbox', '--disable-gpu', '--window-size=1500,1100', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, sid;
const timeline = [];
const note = (s) => { timeline.push(s); console.log(s); };

try {
  let u;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { u = (await r.json()).webSocketDebuggerUrl; break; } } catch {} await sleep(250); }
  ws = new globalThis.WebSocket(u);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = (m, p = {}, s) => new Promise((rs, rj) => { const id = Math.floor(Math.random() * 1e9); const h = (e) => { const x = JSON.parse(e.data); if (x.id === id) { ws.removeEventListener('message', h); x.error ? rj(new Error(x.error.message)) : rs(x.result); } }; ws.addEventListener('message', h); ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s })); });
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: sid } = await cdp('Target.attachToTarget', { targetId, flatten: true }));
  await cdp('Runtime.enable', {}, sid);
  await cdp('Page.enable', {}, sid);

  const go = async (url) => { await cdp('Page.navigate', { url }, sid); await sleep(3500); };
  const evalJs = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const where = () => evalJs('location.pathname');
  const text = () => evalJs('document.body.innerText.replace(/\\s+/g," ").slice(0,260)');
  const clickText = async (needle) => evalJs(`(() => {
    const els = [...document.querySelectorAll('button,a,[role=button],input[type=submit]')];
    const el = els.find(e => (e.innerText || e.value || '').trim().toLowerCase().includes(${JSON.stringify(needle.toLowerCase())}));
    if (!el) return 'NOT FOUND';
    el.click(); return 'clicked: ' + (el.innerText || el.value || '').trim().slice(0,40);
  })()`);
  const setField = (sel, val) => evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'NO FIELD ' + ${JSON.stringify(sel)};
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(val)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);

  // ---- 1. create the account through the API ----
  //
  // Deliberately NOT driven through the register form. Two reasons:
  //
  //   a) Registration is already proven working - `POST /auth/register`
  //      returns 201 and writes a users row. It is not the reported bug.
  //   b) Synthesising React input events does not satisfy the form's
  //      client-side password-strength validation, so the form silently
  //      refuses to submit and the test fails for a reason that has nothing
  //      to do with the app. Chasing that is a test bug, not a product bug.
  //
  // The bug being hunted is the POST-LOGIN flow, so that is what the browser
  // drives.
  note('1. create account (API) + mark verified');
  {
    const { execSync } = await import('node:child_process');
    const body = JSON.stringify({ email: EMAIL, password: PASS, username: USER, biometricCapable: true, fullName: 'E2E' });
    const r = await fetch(`${API}/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    note('   register -> HTTP ' + r.status);
    execSync(`docker exec wideo11-postgres psql -U postgres -d auth_service -t -A -c "UPDATE users SET is_verified = true WHERE email = '${EMAIL}'"`, { stdio: 'ignore' });
    note('   marked verified');
  }

  // ---- 2. log in through the real form ----
  note('2. log in (real form)');
  await go(`${WEB}/auth/login`);
  await setField('#email', EMAIL);
  await setField('#password', PASS);
  await sleep(500);
  const clicked = await clickText('log in');
  note('   ' + clicked);
  if (clicked.startsWith('NOT FOUND')) note('   buttons: ' + (await evalJs(`[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).join(' | ')`)));
  await sleep(8000);
  note('   landed on: ' + (await where()) + '  | ' + (await text()));

  // ---- 3. security gate ----
  note('3. security gate');
  if ((await where()).includes('security-setup')) {
    await setField('#pin', PIN);
    await setField('#confirmPin', PIN);
    await sleep(300);
    note('   ' + (await clickText('continue')));
    await sleep(3500);
    note('   after PIN -> ' + (await where()) + '  | ' + (await text()));

    // questions: pick 3 distinct options and answer them
    await evalJs(`(() => {
      const sels = [...document.querySelectorAll('select')];
      if (sels.length < 3) return 'selects: ' + sels.length;
      const seen = new Set();
      sels.forEach((s, i) => {
        const opt = [...s.options].find(o => o.value && !seen.has(o.value));
        if (opt) { seen.add(opt.value); s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      return 'picked ' + seen.size;
    })()`);
    await sleep(600);
    await evalJs(`(() => {
      const inputs = [...document.querySelectorAll('input[placeholder="Your answer"]')];
      inputs.forEach((el, i) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, 'answer-' + (i + 1));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      return 'answered ' + inputs.length;
    })()`);
    await sleep(300);
    note('   ' + (await clickText('complete setup')));
    await sleep(4000);
    note('   after questions -> ' + (await where()) + '  | ' + (await text()));

    // The skip affordance is deliberately worded to survive both renderings:
    // "continue without biometric" when the device reports no sensor, and
    // "this isn't working" when it claims one but the sensor never responds.
    const skipClicked = await clickText("isn't working");
    note('   ' + skipClicked);
    if (skipClicked.startsWith('NOT FOUND')) {
      note('   !! no skip affordance at all - user is TRAPPED. buttons: '
        + (await evalJs(`[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(Boolean).join(' | ')`)));
    }
    await sleep(8000);
    note('   after skip -> ' + (await where()) + '  | ' + (await text()));
  } else {
    note('   NOT on security-setup; page text: ' + (await text()));
  }

  // ---- 4. the assertion: did we land, and stay landed? ----
  note('4. verify the user STAYS on the dashboard (not a loop)');
  const landings = [];
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    landings.push(await where());
  }
  note('   sampled every 2.5s: ' + landings.join(' -> '));
  const bounces = landings.filter((p) => p.includes('security-setup')).length;
  note('   bounces back to security-setup: ' + bounces);

  const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
  writeFileSync(SHOT, Buffer.from(data, 'base64'));
  note('screenshot: ' + SHOT);
  note(bounces === 0 && landings.some((p) => p.includes('dashboard'))
    ? 'RESULT: PASS - user reaches the dashboard and stays there'
    : 'RESULT: FAIL - ' + bounces + '/6 samples were still bounced to security-setup');
} catch (e) {
  console.error('failed:', e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
  try { rmSync(userDir, { recursive: true, force: true }); } catch {}
}
