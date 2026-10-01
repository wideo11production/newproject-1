#!/usr/bin/env node
// Drive the editor's account menu in a real browser, signed in.
//
// A signed-in user is a 307-redirect-shaped case that SSR cannot show: the
// avatar cluster only renders after `/api/session` resolves, so reading the
// server response would report a "not present" failure for a control that is
// working perfectly. Same reason the earlier `read-dom` attempt was meaningless
// here.
//
// Usage:  node tools/check-account-menu.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { login, SESSION_COOKIE } from './harness-session.mjs';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:3002/';

const profile = mkdtempSync(join(tmpdir(), 've-menu-'));
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

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);

// Real session, exactly like the other browser tools.
const token = await login();
await send('Network.setCookie', { name: SESSION_COOKIE, value: token, domain: 'localhost', path: '/' }, sessionId);

await send('Page.navigate', { url: URL }, sessionId);
await new Promise((r) => setTimeout(r, 2500));

const ev = async (expression) => {
  const { result } = await send(
    'Runtime.evaluate',
    { expression: `JSON.stringify(${expression})`, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return JSON.parse(result.result.value ?? 'null');
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`PASS  ${name}`, detail ? JSON.stringify(detail) : ''); }
  else { fail++; console.log(`FAIL  ${name}`, detail ? JSON.stringify(detail) : ''); }
};

const before = await ev(`(() => ({
  avatar: !!document.querySelector('button[aria-label^="Account menu for"]'),
  avatarText: document.querySelector('button[aria-label^="Account menu for"]')?.innerText?.trim() ?? null,
  avatarRing: (() => {
    const b = document.querySelector('button[aria-label^="Account menu for"]');
    return b ? getComputedStyle(b).boxShadow + ' | ' + b.className.includes('ring-green-500') : null;
  })(),
  registerShown: document.querySelectorAll('a[aria-label="Create an account"]').length,
  signInShown: document.querySelectorAll('a[aria-label="Log in"]').length,
  menuOpen: !!document.querySelector('[role="menu"]'),
}))()`);

check('a signed-in session shows the avatar, not the register button', before.avatar, before);
check('the avatar carries the green signed-in ring', before.avatarRing?.includes('true'), { ring: before.avatarRing });
check('no register / log-in prompt is shown while signed in', before.registerShown === 0 && before.signInShown === 0, {
  register: before.registerShown,
  signIn: before.signInShown,
});
check('the account menu is closed until asked for', before.menuOpen === false);

await ev(`document.querySelector('button[aria-label^="Account menu for"]').click()`);
await new Promise((r) => setTimeout(r, 250));

const open = await ev(`(() => {
  const m = document.querySelector('[role="menu"]');
  if (!m) return { open: false };
  return {
    open: true,
    expanded: document.querySelector('button[aria-label^="Account menu for"]').getAttribute('aria-expanded'),
    email: m.querySelector('p')?.innerText ?? null,
    items: [...m.querySelectorAll('[role="menuitem"]')].map((i) => ({ label: i.innerText.trim(), href: i.getAttribute('href') })),
  };
})()`);

check('clicking the avatar opens the account menu', open.open === true, open);
check('the menu is announced as expanded', open.expanded === 'true', { expanded: open.expanded });
check('the menu names the signed-in account', /\@/.test(open.email ?? ''), { email: open.email });
check('the menu offers a dashboard link', (open.items ?? []).some((i) => /dashboard/i.test(i.label) && !!i.href), {
  items: open.items,
});

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
await new Promise((r) => setTimeout(r, 250));
const afterEsc = await ev(`!!document.querySelector('[role="menu"]')`);
check('Escape closes the menu', afterEsc === false);

await ev(`document.querySelector('button[aria-label^="Account menu for"]').click()`);
await new Promise((r) => setTimeout(r, 200));
await ev(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
await new Promise((r) => setTimeout(r, 250));
const afterOutside = await ev(`!!document.querySelector('[role="menu"]')`);
check('clicking outside closes the menu', afterOutside === false);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }
process.exit(fail === 0 ? 0 : 1);
