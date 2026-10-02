#!/usr/bin/env node
// Verify a channel page shows its identity and its published media.
//
// Public, so no login: that is the point of the page, and a check that had to
// sign in would not prove it is reachable by the people it is for.
//
// Usage:  node tools/check-channel-page.mjs [handle]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const HANDLE = process.argv[2] ?? 'rajajobhikarchannel';

const profile = mkdtempSync(join(tmpdir(), 'chpage-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

const wsUrl = await new Promise((resolve, reject) => {
  let b = '';
  const t = setTimeout(() => reject(new Error('no debug url')), 20000);
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
const go = async (u, w = 3500) => { await send('Page.navigate', { url: u }, sessionId); await new Promise((r) => setTimeout(r, w)); };

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`PASS  ${n}`, d ? JSON.stringify(d) : ''); } else { fail++; console.log(`FAIL  ${n}`, d ? JSON.stringify(d) : ''); } };

// No sign-in anywhere in this file: the page is public, and a check that had to
// log in would not prove it.
await go(`${WEB}/channel/@${HANDLE}`, 4000);

const page = await ev(`(() => {
  const t = document.body.innerText;
  return {
    url: location.pathname,
    notLoginForm: !document.querySelector('input[type="password"]'),
    hasHandle: t.includes('@${HANDLE}'),
    hasTabs: ['Home', 'Videos', 'Shorts'].every((x) => new RegExp('^' + x + '$', 'm').test(t)),
    tileCount: document.querySelectorAll('img[src*="example.test"]').length,
    names: [...document.querySelectorAll('p')].map(p => p.innerText.trim()).filter(x => /\\.mp4$/.test(x)).slice(0, 4),
  };
})()`);

check('the page loads WITHOUT a session', page.notLoginForm === true, page);
check('it shows the handle', page.hasHandle === true, page);
check('it has Home / Videos / Shorts tabs', page.hasTabs === true, page);
check('it lists the published media', page.tileCount > 0, { tiles: page.tileCount, names: page.names });

// The Shorts tab must show only the reel, and Videos only the video.
await ev(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(b => /^Shorts$/i.test((b.textContent || '').trim()));
  tab?.click();
  return !!tab;
})()`);
await new Promise((r) => setTimeout(r, 2500));

const shorts = await ev(`(() => {
  const names = [...document.querySelectorAll('p')].map(p => p.innerText.trim()).filter(x => /\\.mp4$/.test(x));
  return { count: names.length, names, selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() };
})()`);
check('the Shorts tab selects', shorts.selectedTab === 'Shorts', shorts);
check(
  'the Shorts tab shows ONLY the reel',
  shorts.count === 1 && /short/i.test(shorts.names[0] ?? ''),
  shorts
);

await ev(`(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(b => /^Videos$/i.test((b.textContent || '').trim()));
  tab?.click();
  return !!tab;
})()`);
await new Promise((r) => setTimeout(r, 2500));

const videos = await ev(`(() => {
  const names = [...document.querySelectorAll('p')].map(p => p.innerText.trim()).filter(x => /\\.mp4$/.test(x));
  return { count: names.length, names };
})()`);
check(
  'the Videos tab shows ONLY the video',
  videos.count === 1 && /reel clip/i.test(videos.names[0] ?? ''),
  videos
);

// A handle that cannot exist must not look like a page.
await go(`${WEB}/channel/@no_such_channel_probe_xyz`, 3500);
const missing = await ev(`(() => {
  const t = document.body.innerText;
  return { saysNotFound: /not found/i.test(t), showsLogin: !!document.querySelector('input[type="password"]') };
})()`);
check('a missing channel says so, and does not fall back to a login form', missing.saysNotFound === true && missing.showsLogin === false, missing);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
process.exit(fail === 0 ? 0 : 1);