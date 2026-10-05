// A favicon that updates when the file changes, or does not.
//
// -----------------------------------------------------------------------------
// THE BUG THIS EXISTS FOR
// -----------------------------------------------------------------------------
//
// `apps/superadmin/src/app/layout.tsx` declared its icon by hand:
//
//     icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] }
//
// That looks correct and it froze the tab icon at its pre-fix state, forever.
//
// Next.js turns `app/icon.svg` into a CONTENT-HASHED url automatically:
//
//     /icon.svg?8f18ee004c68b569
//
// and the hash changes whenever the file changes. That is the whole mechanism by
// which an UPDATED icon reaches a browser that already cached the old one: new
// file, new hash, new url, refetch. Declaring the url by hand replaced that with
// the bare `/icon.svg` — constant for the life of the app — so the browser cached
// whatever it saw first and had no signal that anything had changed.
//
// Reported twice as "the 3008 tab icon is dull". The bytes on the wire were
// demonstrably correct: `stroke-width="5"`, `stroke-dasharray="46 117"`, and a
// headless browser rendering those exact bytes measured 255/256 pixels of contrast
// at 16px with the SMIL timeline advancing.
//
// So the file was right, the check was right, and the browser was faithfully
// showing a cache. Every existing check passed, because every one of them asked
// "is the icon correct?" rather than "can the browser ever learn it changed?".
//
// -----------------------------------------------------------------------------
// WHY THIS IS A SOURCE CHECK AND NOT ANOTHER BROWSER ONE
//
// Because the property is about a URL's SHAPE, and the shape is visible in the
// built HTML without a browser. A browser check that loads the page would pass on
// the broken version too - the served bytes are correct in both cases; only the
// url differs. It has to be asserted here.
//
// The runtime half is `tools/check-icon-per-page.mjs`, which reads pixels at 16px.
// Between them: this proves the url can change, that proves the result is visible.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

// The eight app roots. `src/app` versus `app` is detected rather than listed,
// because listing it wrong is how `billing` got skipped by an earlier generator.
const APPS = ['web', 'admin', 'analytics', 'billing', 'currency', 'monitor', 'video-editor', 'superadmin'];

function appDir(app) {
  const src = join(ROOT, 'apps', app, 'src', 'app');
  if (existsSync(src)) return src;
  return join(ROOT, 'apps', app, 'app');
}

console.log(`FAVICON UPDATEABILITY\n${'='.repeat(70)}`);

for (const app of APPS) {
  const dir = appDir(app);
  const layout = join(dir, 'layout.tsx');

  if (!existsSync(layout)) {
    check(`${app}: has a layout`, false, `${layout} not found`);
    continue;
  }

  const src = readFileSync(layout, 'utf8');

  // ---- The actual assertion ----
  //
  // Comments are stripped, because the comment block above the removed line
  // discusses `icons:` at length, and a check that matched the word would have
  // kept passing after the fix. That is the repository's most persistent lesson
  // and it is worth not relearning a sixth time.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');

  // `icons:` as a METADATA KEY. `metadata.icons` freezes the url.
  //
  // Matched as `icons:` rather than the word `icons` so a comment or a JSX prop
  // cannot satisfy it. The block form is `icons: {`; a single-line `icons:` is
  // also frozen, so both are rejected.
  const declaresIcons = /(?:^|\n)\s*icons\s*:/.test(code);

  check(`${app}: does not pin the icon url`, !declaresIcons,
    declaresIcons
      ? 'layout.tsx declares `icons:` with a hand-written url.\n' +
        '        Next content-hashes app/icon.svg automatically, and that hash is the only\n' +
        '        mechanism that lets an updated icon reach a browser which already\n' +
        '        cached the old one. A pinned url is constant forever, so the browser\n' +
        '        keeps showing whatever it fetched first.'
      : '');

  // ---- And the icon file must actually exist ----
  //
  // Without the pinned url, `app/icon.svg` IS the tab icon. No file, no icon -
  // and nothing tells you, because an absent icon file is a normal state.
  const hasSvg = existsSync(join(dir, 'icon.svg'));
  check(`${app}: has app/icon.svg`, hasSvg,
    hasSvg ? '' : 'no icon.svg in the app dir; Next emits no <link rel=icon> without it');
}

const failed = results.filter((r) => !r.ok).length;
console.log('='.repeat(70));
console.log(`${results.length - failed}/${results.length} passed`);
if (failed === 0) {
  console.log('\nEvery icon is content-hashed by Next, so a changed icon is a changed url.');
}
process.exit(failed === 0 ? 0 : 1);
