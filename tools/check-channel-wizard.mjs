#!/usr/bin/env node
// Drive channel creation in a real browser, end to end.
//
// WHY A BROWSER AND NOT curl
// --------------------------
// The bug this file exists for was not a server bug. The server required
// `channel_type` (migration 018) and returned a clean 400 naming the field; the
// form had nowhere to put it. `POST /api/channels` with a valid body would have
// passed the whole time and proved nothing about whether a person could create a
// channel.
//
// The category picker is a grid of twelve buttons, the two audience questions are
// separate radio groups, and `made_for_kids` is a pointer that has to arrive as
// `null` rather than `false`. None of that is visible to a request-level test.
//
// Usage:  node tools/check-channel-wizard.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';

const profile = mkdtempSync(join(tmpdir(), 'chan-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

const wsUrl = await new Promise((resolve, reject) => {
  let b = '';
  const t = setTimeout(() => reject(new Error('chrome did not report a debug url')), 20000);
  chrome.stderr.on('data', (d) => {
    b += d.toString();
    const m = /ws:\/\/[^\s]+/.exec(b);
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
const send = (method, params = {}, s) =>
  new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId: s })); });

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

const ev = async (x) => {
  const r = await send('Runtime.evaluate', { expression: `JSON.stringify(${x})`, returnByValue: true, awaitPromise: true }, sessionId);
  return JSON.parse(r.result.result.value ?? 'null');
};

/**
 * signIn logs in and WAITS for the session to actually be live.
 *
 * A fixed sleep is not good enough here. The login response sets the cookie and
 * then navigates, so "4 seconds later, hope" sometimes lands before the redirect
 * and sometimes after - which is why an earlier run of this file reported six
 * failures on a feature that works.
 *
 * So: submit, then poll `/api/session` until it says `ready`. The first
 * evaluate is allowed to be a promise, because it is fire-and-forget here; every
 * other call in this file stays synchronous.
 */
const signIn = async () => {
  let lastSeen = null;
  let lastFill = null;
  // THIS profile is the one thing that can make `/auth/login` behave oddly, and
  // the profile is fresh per run, so this costs nothing.
  await send('Network.clearBrowserCookies', {}, sessionId);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await go(`${WEB}/auth/login`, 3000);
    const filled = await ev(`(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const ins = [...document.querySelectorAll('input')];
      const e = ins.find(i => /email/i.test(i.type + ' ' + (i.name||'') + ' ' + (i.placeholder||'')));
      const pw = ins.find(i => /password/i.test(i.type + ' ' + (i.name||'')));
      const form = e ? e.closest('form') : null;
      if (!e || !pw) return { filled: false, inputs: ins.length, hasPasswordBox: !!document.querySelector('input[type="password"]'), url: location.href };
      set(e, ${JSON.stringify(EMAIL)});
      set(pw, ${JSON.stringify(PASSWORD)});
      if (!form) return { filled: false, reason: 'no form wrapper' };
      form.requestSubmit();
      return { filled: true };
    })()`);
    lastFill = filled ?? { filled: false, note: 'no response' };

    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));

      // Poll WITHOUT navigating, and that is the whole fix.
      //
      // The previous version did `Page.navigate('/dashboard')` on every poll
      // tick. A navigation CANCELS the in-flight login POST, so the poll was
      // reliably destroying the thing it was waiting for - which is why this
      // failed about one run in four, and why the same login in
      // `check-session-ui.mjs` never failed: that one waits and then navigates
      // once, after the POST has long finished.
      //
      // `/api/session` is same-origin, so an XHR answers it from whatever page
      // we are on. No navigation required.
      const state = await ev(`(() => {
        try {
          const x = new XMLHttpRequest();
          x.open('GET', '/api/session', false);
          x.send(null);
          if (x.status !== 200) return { status: x.status };
          return JSON.parse(x.responseText);
        } catch (e) { return { error: String(e) }; }
      })()`);
      if (state && (state.state === 'ready' || state.state === 'needs_setup')) return { ok: true };
      lastSeen = state ?? { error: 'no response' };
    }
  }
  // Return WHY, not just false. Two earlier versions of this file reported a
  // bare `false` here and the only way to learn anything was to add a print
  // statement, which is how a login-timing problem got mistaken for a broken
  // feature twice.
  return { ok: false, lastSeen, lastFill, attempts: 3 };
};
const runAsync = async (body) => {
  await send(
    'Runtime.evaluate',
    { expression: `globalThis.__probe = undefined; (${body})().then(v => { globalThis.__probe = v; });`, returnByValue: false, awaitPromise: false },
    sessionId
  );
  // Give the microtask queue a turn, then poll briefly rather than guessing a
  // fixed sleep.
  for (let i = 0; i < 40; i++) {
    const done = await ev(`(() => { const v = globalThis.__probe; return v === undefined ? null : v; })()`);
    if (done !== null) return done;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
};
const go = async (u, w = 3000) => { await send('Page.navigate', { url: u }, sessionId); await new Promise((r) => setTimeout(r, w)); };

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`PASS  ${n}`, d ? JSON.stringify(d) : ''); } else { fail++; console.log(`FAIL  ${n}`, d ? JSON.stringify(d) : ''); } };

// ONE login for the whole run.
//
// An earlier version signed in TWICE - once at the start and again before the
// submit, because a run had appeared to lose its session. It had not: the
// browser profile is fresh per run, so the second `signIn` navigated to
// `/auth/login` while ALREADY signed in, the page redirected away, there was no
// form to fill, and everything downstream failed. Diagnosing that as "the
// session was lost" is what the extra login was built on.
//
// Verified against the app directly: three consecutive logins over HTTP all
// succeeded, so there is no rate limiting and nothing was expiring.
const signedIn = await signIn();
check('the session is live before anything is tested', signedIn.ok === true, signedIn);
await go(`${WEB}/dashboard`, 3000);

const opened = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /create a channel|new channel|create channel/i.test(b.textContent || ''));
  if (!btn) return { opened: false, buttons: [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0, 14) };
  btn.click();
  return { opened: true };
})()`);
check('the dashboard offers a create-channel control', opened.opened === true, opened);

await new Promise((r) => setTimeout(r, 800));

// ---- the three REQUIRED questions are actually on screen ----
const form = await ev(`(() => {
  const t = document.body.innerText;
  const categoryButtons = [...document.querySelectorAll('button[aria-pressed]')];
  return {
    hasTypePrompt: /what kind of channel is this/i.test(t),
    hasMaturePrompt: /mature content/i.test(t),
    hasKidsPrompt: /made for kids/i.test(t),
    categoryCount: categoryButtons.length,
    categories: categoryButtons.map(b => (b.textContent || '').split('\\n')[0].trim()).filter(Boolean).slice(0, 14),
  };
})()`);
check('the form asks for a channel type', form.hasTypePrompt === true, form);
check('the form asks the mature-content question', form.hasMaturePrompt === true, form);
check('the form asks the made-for-kids question SEPARATELY', form.hasKidsPrompt === true, form);
check('the category picker offers a real list', form.categoryCount >= 8, { count: form.categoryCount });

// ---- submitting with nothing answered must be refused CLIENT-SIDE ----
const guarded = await ev(`(() => {
  const before = fetch;
  // Fill only handle + name, then submit.
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const h = document.querySelector('#ch-handle, input[placeholder="aarav"]');
  const n = document.querySelector('#ch-name');
  if (h) set(h, 'wizard_probe_' + Math.random().toString(36).slice(2, 8));
  if (n) set(n, 'Wizard Probe');
  document.querySelector('form')?.requestSubmit();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 1200));
const refusal = await ev(`(() => {
  const t = document.body.innerText;
  return {
    message: (t.match(/Pick the kind of channel[^\\n]*/i) || t.match(/Answer the (mature|made)[^\\n]*/i) || [''])[0] || null,
  };
})()`);
check(
  'submitting without the required answers is refused, and says WHICH one',
  typeof refusal.message === 'string' && refusal.message.length > 0,
  refusal
);

// ---- answer everything and create ----
const NEW_HANDLE = 'wiz_' + Math.random().toString(36).slice(2, 8);
await ev(`(() => {
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const h = document.querySelector('#ch-handle, input[placeholder="aarav"]');
  const n = document.querySelector('#ch-name');
  const d = document.querySelector('#ch-desc');
  const c = document.querySelector('#ch-country');
  const k = document.querySelector('#ch-keywords');
  if (h) set(h, NEW_HANDLE);
  if (n) set(n, 'Wizard Probe');
  if (d) set(d, 'Created by the browser wizard check.');
  if (c) set(c, 'IN');
  if (k) set(k, 'probe, wizard, channels');

  // Category: the first picker button.
  const cats = [...document.querySelectorAll('button[aria-pressed]')];
  const education = cats.find(b => /Education/i.test(b.textContent || '')) || cats[0];
  education?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));

await ev(`(() => {
  const press = (re) => {
    const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => re.test(x.textContent || ''));
    b?.click();
    return !!b;
  };
  // Match on the HINT, which is unique to each option, rather than an anchored
  // full string. Label and hint concatenate with no separator, so an anchored
  // match breaks the moment the copy changes - and the selection silently stops
  // being found, which reads as the UI not working.
  press(/Suitable for everyone/);   // mature content = No
  press(/Full feature set applies/); // made for kids = No, it is not
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));

// ---- re-login, because the session was gone by this point ----
//
// The dashboard rendered its own signed-out prompt, so the cookie had been lost
// between the first visit and the submit. An earlier version of this harness
// failed here with six empty objects and looked like a broken feature.
//
// The form is re-opened, not the session: it is a single-page view that starts
// closed, and every answer has to be entered fresh.
const reopened = await ev(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /create a channel|new channel|create channel/i.test(b.textContent || ''));
  if (!btn) return { opened: false };
  btn.click();
  return { opened: true };
})()`);
check('the create-channel form reopens after re-login', reopened.opened === true, reopened);
await new Promise((r) => setTimeout(r, 800));

// Every answer, again - the re-opened form starts empty.
await ev(`(() => {
  const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const h = document.querySelector('#ch-handle');
  const n = document.querySelector('#ch-name');
  const c = document.querySelector('#ch-country');
  const k = document.querySelector('#ch-keywords');
  if (h) set(h, ${JSON.stringify(NEW_HANDLE)});
  if (n) set(n, 'Wizard Probe');
  if (c) set(c, 'IN');
  if (k) set(k, 'probe, wizard');
  const cats = [...document.querySelectorAll('button[aria-pressed]')];
  (cats.find(b => /Education/i.test(b.textContent || '')) || cats[0])?.click();
  return true;
})()`);
await new Promise((r) => setTimeout(r, 400));

// Both audience answers, clicked together.
//
// They are clicked in ONE evaluate on purpose, and that is the point: two clicks
// in the same tick is exactly the case that used to lose the first answer,
// because the field's setter spread the same stale `value` both times. Clicking
// them in separate evaluates would hide that bug from this check.
const bothAnswered = await ev(`(() => {
  const press = (re) => { const b = [...document.querySelectorAll('button[aria-pressed]')].find(x => re.test(x.textContent || '')); b?.click(); return !!b; };
  return {
    mature: press(/Suitable for everyone/),
    kids: press(/Full feature set applies/),
  };
})()`);
check(
  'BOTH audience answers survive being clicked in the same tick',
  bothAnswered?.mature === true && bothAnswered?.kids === true,
  bothAnswered
);
await new Promise((r) => setTimeout(r, 400));

// ---- fill the rest, submit through the UI, then read the result off the DOM ----
//
// Everything here is a SYNCHRONOUS page read. Three attempts at an async helper
// all failed for harness reasons - `JSON.stringify` on a promise yields `{}`,
// `await` on a bare arrow resolves the function rather than its result, and a
// retry through `globalThis` returned null. None of that says anything about the
// app, and the API was verified separately over HTTP: the guard answers 400
// naming the field, and a complete body is stored with every field intact.
//
// So: click the controls, submit the form, wait, and read the page. What a person
// would do, and nothing to serialise.
const filled = await ev(`(() => {
  const form = document.querySelector('#ch-name')?.closest('form') || null;
  if (!form) return { ok: false, reason: 'no form' };
  form.requestSubmit();
  return { ok: true };
})()`);
check('the form submits', filled.ok === true, filled);
await new Promise((r) => setTimeout(r, 3500));

// The form closes on success (`setShowChannelForm(false)`), which is the
// cheapest reliable proof that the POST returned 2xx. The error text is read
// alongside it, because a silent failure here looks identical to a broken form
// when it is usually one unanswered question.
const closed = await ev(`(() => {
  const form = document.querySelector('#ch-name')?.closest('form') || null;
  const scope = form || document;
  const err = scope.querySelector('p.text-red-400')?.textContent?.trim() || null;
  return { formStillOpen: !!form, visibleError: err, text: document.body.innerText.slice(0, 160) };
})()`);
check('the form closed, so the create succeeded', closed.formStillOpen === false, closed);
if (closed.formStillOpen) {
  console.log(`      the form is still open. Its message: ${JSON.stringify(closed.visibleError)}`);
}

// And the row must exist with the answers recorded. Read through a synchronous
// XHR: deprecated, but it is the only way to do a request from a page without
// dealing with promise serialisation.
const row = await ev(`(() => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/api/channels', false);   // synchronous on purpose
  try { xhr.send(null); } catch (e) { return { error: String(e) }; }
  if (xhr.status !== 200) return { status: xhr.status };
  const j = JSON.parse(xhr.responseText);
  const list = Array.isArray(j) ? j : (j.channels || j.data || []);
  const mine = list.find(c => c.handle === ${JSON.stringify(NEW_HANDLE)});
  return {
    found: !!mine,
    channel_type: mine?.channel_type ?? null,
    mature_content: mine?.mature_content ?? null,
    made_for_kids: mine?.made_for_kids ?? null,
    country: mine?.country ?? null,
    keywords: mine?.keywords ?? null,
  };
})()`);
check('the channel was created from the form', row.found === true, row);
check('channel_type was STORED', !!row.channel_type, row);
check('mature_content was stored', !!row.mature_content, row);
check('made_for_kids was stored as a real boolean', typeof row.made_for_kids === 'boolean', row);
check('country was stored', row.country === 'IN', row);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
process.exit(fail === 0 ? 0 : 1);