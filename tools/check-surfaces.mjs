#!/usr/bin/env node
// Prove each app's `NEXT_PUBLIC_*` values reach the BROWSER, not a fallback.
//
// WHY THIS IS NOT A SOURCE-GREP
// -----------------------------
// The bug this catches is invisible in source: every read site has a correct
// hardcoded fallback, so the app behaves right while the env var is dead. The
// only way to tell the two apart is to look at what actually shipped in the
// bundle, or at what the served JS evaluates to at runtime.
//
// The check is behavioural: load each app, click something, and ask the ledger
// what `surface` it recorded. `port-3002` means the fallback fired; `editor`
// means the build arg worked.
//
// Usage:  node tools/check-surfaces.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const APPS = [
  { surface: 'web', port: 3000, note: 'landing' },
  { surface: 'monitor', port: 3001, note: 'landing' },
  { surface: 'editor', port: 3002, note: 'access gate (signed out)' },
  { surface: 'billing', port: 3003, note: 'landing' },
  { surface: 'admin', port: 3004, note: 'landing' },
  { surface: 'analytics', port: 3005, note: 'landing' },
  { surface: 'currency', port: 3007, note: 'rates' },
  { surface: 'superadmin', port: 3008, note: 'token form' },
];

// The ledger moved out of `auth_service` into the analytics service, so this
// reads the new table. Keeping the old one would have made this check fail for
// every app while the pipeline was in fact healthy - a check that reports a lie
// is worse than no check.
//
// Phase 1 of SYSTEM-PLAN.md: `click_events` in auth_service -> `ui_click_events`
// in analytics_service.
function psql(sql) {
  return execFileSync(
    'docker',
    [
      'exec', '-i', 'wideo11-postgres',
      'psql', '-U', 'postgres',
      '-d', 'analytics_service',
      '-t', '-A', '-c', sql,
    ],
    { encoding: 'utf8' }
  );
}

// Start from a clean slate so a stale row cannot pass as a fresh success.
psql('DELETE FROM ui_click_events;');

const profile = mkdtempSync(join(tmpdir(), 've-surf-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
   '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error('no debug url')), 20000);
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

let pass = 0;
let fail = 0;

for (const app of APPS) {
  await send('Page.navigate', { url: `http://localhost:${app.port}/` }, sessionId);
  await new Promise((r) => setTimeout(r, 1800));

  // Dispatch the click ON THE ELEMENT, not at a fixed coordinate.
  //
  // A coordinate click is unreliable here and it produced a false failure: the
  // superadmin landing page renders a token form with zero `<button>` elements,
  // so a click at (60, 60) landed on nothing and nothing was recorded - which
  // read as "the build ARG is missing" when the page was fine.
  //
  // What is actually under test is "does the tracker attach a surface to its
  // events", so the click target is irrelevant. Dispatching on `document.body`
  // guarantees an event and makes the result a property of the tracker rather
  // than of the page's layout.
  await send(
    'Runtime.evaluate',
    {
      expression: `document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }))`,
    },
    sessionId
  );

  // 5s is the tracker's flush interval; pagehide forces an earlier one.
  await new Promise((r) => setTimeout(r, 1200));
  await send('Page.navigate', { url: 'about:blank' }, sessionId);
  await new Promise((r) => setTimeout(r, 700));
}

await new Promise((r) => setTimeout(r, 2500));

const rows = psql('SELECT surface || \'|\' || page FROM ui_click_events ORDER BY surface;')
  .split('\n').map((s) => s.trim()).filter(Boolean);
const seen = new Map();
for (const r of rows) {
  const [surface] = r.split('|');
  seen.set(surface, (seen.get(surface) ?? 0) + 1);
}

console.log('\nsurface recorded        | app           | verdict');
console.log('-----------------------+---------------+--------------------------');
for (const app of APPS) {
  const n = seen.get(app.surface) ?? 0;
  const fallback = seen.get(`port-${app.port}`) ?? 0;
  const ok = n > 0 && fallback === 0;
  if (ok) pass++;
  else fail++;

  // Build the verdict as a value first. Inlining a template inside a template
  // needs escaping, and a nested backtick with `${}` in it is exactly the kind
  // of thing that turns into a syntax error at the worst moment.
  const verdict = n > 0
    ? `OK  ${n} event(s)`
    : `FAIL - ${fallback > 0 ? 'fallback port-' + app.port + ' fired (build ARG missing)' : 'no events recorded'}`;

  const appCol = ':' + app.port;
  console.log(app.surface.padEnd(22) + ' | ' + appCol.padEnd(13) + ' | ' + verdict);
}

const stray = [...seen.keys()].filter((k) => !APPS.some((a) => a.surface === k));
if (stray.length) console.log(`\nunexpected surfaces: ${stray.join(', ')}`);

console.log(`\n${pass}/${pass + fail} apps resolve their NEXT_PUBLIC_APP_SURFACE`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
process.exit(fail === 0 ? 0 : 1);