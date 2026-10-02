#!/usr/bin/env node
// Verify the public channel browse page actually shows what it claims.
//
// A page can render `subscribers` and `videos` and still be lying - the numbers
// can be a hardcoded zero, or a type the API never sent. So this reads the
// RENDERED text, not the response body.
//
// Usage:  node tools/check-channels-browse.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';

const profile = mkdtempSync(join(tmpdir(), 'browse-'));
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

await go(`${WEB}/channels`, 4000);

const page = await ev(`(() => {
  const text = document.body.innerText;
  const cards = [...document.querySelectorAll('a[href^="/channel/@"]')];
  return {
    heading: /^Channels$/m.test(text),
    cardCount: cards.length,
    hasSubscribersWord: /subscribers?/i.test(text),
    hasVideosWord: /\\bvideos\\b/i.test(text),
    hasReelsWord: /\\breels\\b/i.test(text),
    hasUncategorised: /Uncategorized/i.test(text),
    hasCategoryBadge: /Education|Gaming|Music|Podcast/i.test(text),
    filterChips: [...document.querySelectorAll('button[aria-pressed]')].map(b => (b.textContent || '').trim()).filter(Boolean).slice(0, 14),
    firstCard: cards[0] ? cards[0].innerText.replace(/\\n+/g, ' | ').slice(0, 140) : null,
  };
})()`);

check('the browse page renders', page.heading === true, page);
check('channel cards are links to a channel page', page.cardCount > 0, { count: page.cardCount });
check('each card shows a subscriber count', page.hasSubscribersWord === true, {});
check('each card shows a video count', page.hasVideosWord === true, {});
check('each card shows a reel count', page.hasReelsWord === true, {});
check('cards are categorised', page.hasCategoryBadge === true, {});
check('a category filter is offered', page.filterChips.length >= 10, { chips: page.filterChips?.length });

// A card must be more than a name: it should read as a summary of something.
check(
  'a card shows name, handle, category and counts together',
  typeof page.firstCard === 'string' && /@/.test(page.firstCard) && /subscribers?/i.test(page.firstCard),
  { firstCard: page.firstCard }
);

// Click "Gaming" and let the grid refetch.
await ev(`(() => {
  const chip = [...document.querySelectorAll('button[aria-pressed]')].find(b => /^Gaming$/i.test((b.textContent || '').trim()));
  chip?.click();
  return !!chip;
})()`);
await new Promise((r) => setTimeout(r, 3000));
// The filter must actually filter, not just exist.
//
// Scoped to CARD text. The earlier version matched the whole page, and the page
// contains a filter CHIP labelled "Education" - so it reported a leak that was
// really just the filter's own label. A check that cries wolf is the same
// failure as no check at all.
const filtered = await ev(`(() => {
  const cardText = [...document.querySelectorAll('a[href^="/channel/@"]')].map(a => a.innerText);
  const chips = [...document.querySelectorAll('button[aria-pressed]')];
  return {
    gamingPressed: chips.some(b => /^Gaming$/i.test((b.textContent || '').trim()) && b.getAttribute('aria-pressed') === 'true'),
    cardCount: cardText.length,
    cardsWithOtherCategories: cardText.filter(t => /Education|Gaming|Music|Podcast/i.test(t)).slice(0, 3),
  };
})()`);
check('clicking a category filter activates it', filtered.gamingPressed === true, filtered);
check(
  'and the grid shows only that category',
  filtered.cardsWithOtherCategories.length === 0,
  filtered
);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');

ws.close();
chrome.kill();
await new Promise((r) => setTimeout(r, 400));
try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp */ }
process.exit(fail === 0 ? 0 : 1);