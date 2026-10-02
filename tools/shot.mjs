#!/usr/bin/env node
// shot.mjs  -  screenshot a page at a given size.
//
// =============================================================================
// WHY THIS EXISTS
// =============================================================================
//
// A design change cannot be verified by a test that asserts on the DOM.
//
// "The grid has 4 columns" and "the gallery looks like a premium directory" are
// not the same claim, and only one of them is what the user asked for. Every
// layout mistake worth catching - a card that overflows, a grid that is too tight,
// a header that dwarfs the content, a filter that wraps onto three lines - passes
// every assertion and looks wrong.
//
// So the page is screenshotted and looked at.
//
//   node tools/shot.mjs /channels out.png 1440 2400
//   node tools/shot.mjs http://localhost:3001/ monitor.png 1440 900
//
// A `route` starting with `http` is used verbatim, which is the only way to shoot
// an app other than `WEB_URL`. The first monitor screenshot came back showing the
// MARKETING PAGE on port 3000 - a green PASS for a completely wrong app, because
// the tool silently substituted its default base URL and said nothing.
//
// Uses the shared harness, so there is one Chrome launcher in this repo rather
// than three.

import { writeFileSync } from 'node:fs';
import { openHarness, ENV } from './lib/harness.mjs';

const [, , route = '/', out = 'shot.png', w = '1440', h = '2400'] = process.argv;

// An absolute URL wins over ENV.WEB. Said out loud here because the alternative -
// silently falling back to the default host - produced a screenshot of the wrong
// application that looked like a successful run.
const target = /^https?:\/\//.test(route) ? route : `${ENV.WEB}${route}`;
if (!/^https?:\/\//.test(route) && ENV.WEB !== 'http://localhost:3000') {
  console.log(`note: shooting ${target}`);
}

const h2 = await openHarness({ onLog: (m) => console.log(m) });

try {
  await h2.navigate(target, 5000);
  // The gallery is client-rendered behind a dynamic import, so the skeleton has to
  // be gone before the shot means anything. Wait for real cards, not for a timer.
  for (let i = 0; i < 30; i++) {
    const ready = await h2.evaluate(
      `document.querySelectorAll('[data-track^="gallery-card-"]').length > 0`
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  // Let images decode, so the shot does not show empty image frames.
  await h2.evaluate(
    `Promise.all([...document.images].map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => true)`
  );
  await new Promise((r) => setTimeout(r, 700));

  const png = await h2.screenshot(Number(w), Number(h));
  writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`wrote ${out}`);
} finally {
  await h2.close();
}
