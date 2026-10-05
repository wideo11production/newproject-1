// Apply the 16px-legible arc to every icon that uses the shared "W" brand mark.
//
// WHY ONLY THREE OF THE SIX
//
// `apps/monitor` and `apps/video-editor` ship BESPOKE artwork — a chart line and a
// video camera — not the brand "W". Stamping a generic brand arc onto them would
// put a rotating ring around an unrelated glyph, which is worse than leaving them
// static: it reads as a mistake and it moves for no reason.
//
// So the rule is "the apps that use the W get the W treatment", and it is stated
// here rather than implied by which files this script happened to edit.
//
// WHAT CHANGED AND WHY — the numbers are the point
//
//   stroke-width   3 -> 5   5 units at 64 is 1.25px at 16px, which is above the
//                             threshold where a browser stops drawing a stroke
//                             cleanly and starts drawing a translucent smear.
//                             3 units cannot be rescued by colour at 16px; it is
//                             below one device pixel.
//
//   fade endpoint  0 -> 0.25 the old gradient ran to fully transparent, so the
//                             tail of the sweep was not drawn at all and the
//                             visible arc was under a third of the ring.
//
//   dasharray      30 -> 46  more of the ring is drawn at all, for the same reason.
//
//   accent         mid -> near-white  a mid-tone arc on a mid-tone gradient is two
//                             similar values adjacent to each other, which is low
//                             contrast by construction. A near-white core is the
//                             brightest thing on the icon at any size.
//
// What is deliberately NOT changed: the brand gradient, the W geometry, and the
// 2.6s duration. Rendered at 16/32/128 the W reads well, and a fast spinner in a
// tab strip reads as "something is loading" permanently.

import { readFileSync, writeFileSync } from 'node:fs';

const BRAND_W_APPS = [
  { file: 'apps/web/src/app/icon.svg', label: 'Wideo11', from: ['#93c5fd', '#60a5fa'], to: ['#ffffff', '#93c5fd'] },
  { file: 'apps/admin/src/app/icon.svg', label: 'Wideo11 Admin', from: ['#7dd3fc', '#38bdf8'], to: ['#ffffff', '#7dd3fc'] },
  { file: 'apps/superadmin/src/app/icon.svg', label: 'Wideo11 Superadmin', from: ['#fb7185', '#f43f5e'], to: ['#ffffff', '#fb7185'] },
];

/** Replace the accent gradient wholesale. */
function newGradient(label, [bright, tail]) {
  return `    <linearGradient id="accent" x1="8" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
      <stop offset="0%"   stop-color="${bright}" stop-opacity="1"/>
      <stop offset="45%"  stop-color="${bright}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${tail}" stop-opacity="0.25"/>
    </linearGradient>
  </defs>`;
}

let changed = 0;

for (const app of BRAND_W_APPS) {
  let svg = readFileSync(app.file, 'utf8');

  const before = svg;

  // ---- 1. the accent gradient ----
  svg = svg.replace(
    /<linearGradient id="accent"[\s\S]*?<\/linearGradient>/,
    newGradient(app.label, app.to).replace(/\n\s*<\/defs>$/, '')
  );

  // ---- 2. stroke width + dash length on the arc ----
  svg = svg.replace(/stroke-width="3"/, 'stroke-width="5"');
  svg = svg.replace(/stroke-dasharray="30 133"/, 'stroke-dasharray="46 117"');

  // ---- 3. the geometry comment is now wrong; replace it ----
  svg = svg.replace(
    /<!--[\s\S]*?stroke-dashoffset="0">/,
    `<!--
    r=26 with a 5px stroke puts the outer edge at 28.5 from centre. The rounded
    square's boundary is 32 on the axes but ~39.5 on the diagonals, so the axes are
    the tightest part and 28.5 clears both. It also clears the mark itself, which
    reaches ~22 at its widest stroke, so the arc sweeps BEHIND the letter.
  -->
  <circle cx="32" cy="32" r="26" fill="none" stroke="url(#accent)"
          stroke-width="5" stroke-linecap="round"
          stroke-dasharray="46 117" stroke-dashoffset="0">`
  );

  if (svg === before) {
    console.log(`  same  ${app.file}`);
    continue;
  }
  writeFileSync(app.file, svg);
  console.log(`  edit  ${app.file}  -> stroke 5, dash 46, bright accent`);
  changed++;
}

console.log(`\n${changed} icon(s) updated`);
console.log('monitor and video-editor are deliberately untouched: bespoke artwork, not the brand W.');
console.log('verify with: node tools/check-icon-svg.mjs && node tools/render-icons.mjs');