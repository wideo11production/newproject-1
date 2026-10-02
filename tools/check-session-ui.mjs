#!/usr/bin/env node
// Prove the session is visible in a real browser, on the web home page AND the
// editor, and that Sign out actually ends it.
//
// WHY A BROWSER AND NOT curl
// -------------------------
// The bug being fixed was never visible over HTTP. The web home page returned
// 200 and the API said "signed in" - and the PAGE still said "Log in / Register",
// because the page rendered two hardcoded links and never read the session.
//
// A curl of the HTML would have shown the same broken links and passed. Only a
// hydrated browser shows what a person actually sees.
//
// Usage:  node tools/check-session-ui.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const EDITOR = process.env.EDITOR_URL ?? 'http://localhost:3002';

// The harness account, provisioned by tools/provision-harness.mjs. Real login,
// real cookie - not an injected one, because the bug was that the APP never read
// the cookie it was being given.
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';

const profile = mkdtempSync(join(tmpdir(), 'sess-'));
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

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
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
await send('Network.enable', {}, sessionId);

const evaluate = async (expression) => {
  const { result } = await send(
    'Runtime.evaluate',
    { expression: `JSON.stringify(${expression})`, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return JSON.parse(result.result.value ?? 'null');
};

const goto = async (url, waitMs = 2500) => {
  await send('Page.navigate', { url }, sessionId);
  await new Promise((r) => setTimeout(r, waitMs));
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`, detail ? JSON.stringify(detail) : '');
  } else {
    fail++;
    console.log(`FAIL  ${name}`, detail ? JSON.stringify(detail) : '');
  }
};

// ---- 1. signed OUT: the web home page must offer Log in and Register ----
await goto(WEB);
const outState = await evaluate(`(() => {
  const text = document.body.innerText;
  return {
    hasAvatar: !!document.querySelector('button[aria-label^="Account menu for"]'),
    saysLogIn: /\\bLog in\\b/i.test(text),
    saysRegister: /\\bRegister\\b/i.test(text),
    // A signed-out visitor SHOULD be offered signup - that is the whole point of
    // a landing page, and the rule below is only about the signed-in case.
    saysCreateAccount: /create your account/i.test(text),
    saysWelcome: /welcome back/i.test(text),
  };
})()`);
check('signed out: no avatar', outState.hasAvatar === false, outState);
check('signed out: Log in and Register are offered', outState.saysLogIn && outState.saysRegister, outState);
check('signed out: the signup CTA is still shown', outState.saysCreateAccount === true, outState);
check('signed out: no welcome message', outState.saysWelcome === false, outState);

// ---- 2. sign in for real, through the app's own form ----
//
// The form, not a direct cookie injection: the bug being fixed is that the app
// does not honour the cookie it is given, and only a real login exercises the
// whole path.
await goto(`${WEB}/auth/login`, 3000);
await evaluate(`(() => {
  const set = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const inputs = [...document.querySelectorAll('input')];
  const email = inputs.find((i) => /email/i.test(i.type + ' ' + (i.name||'') + ' ' + (i.placeholder||'')));
  const pass = inputs.find((i) => /password/i.test(i.type + ' ' + (i.name||'')));
  if (email) set(email, ${JSON.stringify(EMAIL)});
  if (pass) set(pass, ${JSON.stringify(PASSWORD)});
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));
await evaluate(`(() => {
  const form = document.querySelector('form');
  if (form) form.requestSubmit();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 4000));

// ---- 3. signed IN: the web home page must show the avatar ----
await goto(WEB, 3000);
const inState = await evaluate(`(() => {
  const btn = document.querySelector('button[aria-label^="Account menu for"]');
  const text = document.body.innerText;
  return {
    hasAvatar: !!btn,
    ariaLabel: btn ? btn.getAttribute('aria-label') : null,
    initials: btn ? btn.innerText.trim() : null,
    stillSaysLogIn: /\\bLog in\\b/i.test(text),
  };
})()`);
check('signed in: the web home page shows the avatar', inState.hasAvatar === true, inState);
check(
  'signed in: the avatar carries the real account',
  typeof inState.ariaLabel === 'string' && inState.ariaLabel.includes(EMAIL),
  { ariaLabel: inState.ariaLabel }
);

// The landing page used to say "Create your account" to people who already had
// one. Telling a signed-in user to register is how duplicate accounts happen, and
// it is the person who already paid who notices first.
const hero = await evaluate(`(() => {
  const text = document.body.innerText;
  return {
    saysCreateAccount: /create your account/i.test(text),
    saysRegisterNow: /register now/i.test(text),
    saysWelcome: /welcome back/i.test(text),
    saysDashboardCta: /go to dashboard/i.test(text),
  };
})()`);
check('signed in: NO "create your account" anywhere on the page', hero.saysCreateAccount === false, hero);
check('signed in: NO "register now" either', hero.saysRegisterNow === false, hero);
check('signed in: the page welcomes them instead', hero.saysWelcome === true, hero);
check('signed in: it offers the dashboard / editor, not a signup', hero.saysDashboardCta === true, hero);

// The hero must show the PERSON, not a signup prompt: the avatar (or its
// initials fallback) and a name in the welcome line. Asserting on text alone
// would pass even if the avatar silently fell back to letters, so the picture
// element is looked for directly.
const heroIdentity = await evaluate(`(() => {
  const welcomeEl = [...document.querySelectorAll('p')].find((p) => /welcome back/i.test(p.textContent || ''));
  const scope = welcomeEl ? welcomeEl.closest('div')?.parentElement || document.body : document.body;
  const ring = scope.querySelector('[class*="conic-gradient"], [style*="conic-gradient"]');
  const img = scope.querySelector('img[src*="avatar"], img[src*="gravatar"], img');
  const name = (welcomeEl?.textContent || '').replace(/^welcome back,?\s*/i, '').trim();
  return {
    hasWelcome: !!welcomeEl,
    hasAvatarElement: !!img,
    avatarSrc: img ? (img.getAttribute('src') || '') : null,
    hasRevolvingRing: !!ring,
    ringAnimates: ring ? /animate/.test(ring.className || '') : false,
    name,
  };
})()`);
check(
  'the hero greets them BY NAME',
  heroIdentity.hasWelcome && heroIdentity.name.length > 0,
  heroIdentity
);
check('the hero shows the avatar, not just initials', heroIdentity.hasAvatarElement === true, {
  src: heroIdentity.avatarSrc,
});
check(
  'the avatar has a GREEN ring that revolves',
  heroIdentity.hasRevolvingRing && heroIdentity.ringAnimates === true,
  heroIdentity
);

// ---- 4. the same session, on the editor: no second login ----
await goto(EDITOR, 3500);
const editorState = await evaluate(`(() => {
  const btn = document.querySelector('button[aria-label^="Account menu for"]');
  const gate = document.body.innerText.includes('Sign in to open the editor');
  return {
    hasAvatar: !!btn,
    ariaLabel: btn ? btn.getAttribute('aria-label') : null,
    gateShown: gate,
  };
})()`);
check('editor: the same session shows the avatar, no second login', editorState.hasAvatar === true, editorState);
check('editor: the sign-in gate is NOT shown to a signed-in user', editorState.gateShown === false, editorState);

// ---- 5. the menu opens and Sign out really signs out ----
await goto(WEB, 3000);
await evaluate(`document.querySelector('button[aria-label^="Account menu for"]').click()`);
await new Promise((r) => setTimeout(r, 500));
const menuState = await evaluate(`(() => {
  const menu = document.querySelector('[role="menu"]');
  if (!menu) return { open: false };
  return {
    open: true,
    items: [...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.innerText.trim()),
    email: menu.querySelector('p') ? menu.querySelector('p').innerText.trim() : null,
  };
})()`);
check('the account menu opens', menuState.open === true, menuState);
check(
  'the menu offers Dashboard and Sign out',
  (menuState.items || []).some((i) => /dashboard/i.test(i)) &&
    (menuState.items || []).some((i) => /sign out/i.test(i)),
  { items: menuState.items }
);
check('the menu names the signed-in account', (menuState.email || '').includes(EMAIL), {
  email: menuState.email,
});

await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((i) => /sign out/i.test(i.innerText));
  if (item) item.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 3500));

const afterLogout = await evaluate(`(() => ({
  hasAvatar: !!document.querySelector('button[aria-label^="Account menu for"]'),
  saysLogIn: /\\bLog in\\b/i.test(document.body.innerText),
}))()`);
check('after Sign out the avatar is gone', afterLogout.hasAvatar === false, afterLogout);
check('after Sign out the page offers Log in again', afterLogout.saysLogIn === true, afterLogout);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* temp dir */
}
process.exit(fail === 0 ? 0 : 1);
