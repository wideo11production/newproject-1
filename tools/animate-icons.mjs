// Make an existing static brand icon animated, without changing its look otherwise.
//
// Used for the apps that still ship a static `icon.svg` (web, monitor, video-editor).
// Doing this as a script rather than by hand is because the three files were
// already going to be edited the same way three times, and the fourth app would
// then be missed - which is how five copies of `/api/health-check` and seven of
// `/api/audit` happened.
//
// WHAT IT DOES
//   1. inserts an orbiting arc + <animateTransform> before the closing </svg>
//   2. adds the accent gradient the arc needs
//   3. adds aria-label if there is none
//   4. rewrites the width/height off the root so it scales
//
// THE TRAPS THIS WALKED INTO, recorded so they are not walked into again
//
//   * `--` IS ILLEGAL INSIDE AN XML COMMENT. The superadmin icon shipped with
//     `-----` underline rows in its comment, which made the browser reject the
//     ENTIRE document. It served HTTP 200 with the right content-type and looked
//     perfect in the source. `check-icon-svg.mjs` is the regression test.
//
//   * THE BRAND MARK MUST BE DRAWN LAST. The arc sweeps BEHIND the glyph, so it is
//     inserted immediately before `</svg>` - after whatever mark is already there.
//     Inserted first, the logo sits under a moving line and looks smudged.
//
//   * RADIUS IS NOT ARBITRARY. On a 64x64 rounded square with rx=14 the boundary
//     is 32 from centre on the axes but ~39.5 on the diagonals, so the diagonals
//     are the roomiest part. r=26 plus a 3px stroke clears both, and clears the
//     mark itself (~22 at its widest), which is what lets the arc pass behind the
//     letter instead of through it.
//
//   * `gradientUnits="userSpaceOnUse"`. An objectBoundingBox gradient does not
//     rotate with a rotating shape, so the fade would stay put while the arc
//     spun around it.
//
//   * `repeatCount="indefinite"` on a 2.6s duration. Slow on purpose: a favicon
//     repaints continuously for as long as the tab is open, and a fast spinner in a
//     tab strip is genuinely distracting.

import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = [
  {
    file: 'apps/web/src/app/icon.svg',
    label: 'Wideo11',
    arc: ['#93c5fd', '#60a5fa'],
  },
  {
    file: 'apps/monitor/src/app/icon.svg',
    label: 'Wideo11 Monitor',
    arc: ['#6ee7b7', '#10b981'],
  },
  {
    file: 'apps/video-editor/src/app/icon.svg',
    label: 'Wideo11 Editor',
    arc: ['#c4b5fd', '#8b5cf6'],
  },
];

/** Already done - do not double-insert. */
const ALREADY = /animateTransform/;

for (const t of TARGETS) {
  let svg = readFileSync(t.file, 'utf8');

  if (ALREADY.test(svg)) {
    console.log(`SKIP  ${t.file} (already animated)`);
    continue;
  }

  // ---- 1. accent gradient into <defs>, or create <defs> ----
  const gradient = `    <linearGradient id="accent" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${t.arc[0]}" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="${t.arc[1]}" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="${t.arc[1]}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

  if (/<defs>[\s\S]*?<\/defs>/.test(svg)) {
    svg = svg.replace(/<\/defs>/, gradient);
  } else {
    svg = svg.replace(/<svg([^>]*)>/, `<svg$1>\n  <defs>\n${gradient}`);
  }

  // ---- 2. the arc, immediately before </svg> so the existing mark stays on top ----
  const arc = `
  <circle cx="32" cy="32" r="26" fill="none" stroke="url(#accent)"
          stroke-width="3" stroke-linecap="round"
          stroke-dasharray="30 133" stroke-dashoffset="0">
    <animateTransform attributeName="transform" type="rotate"
                      from="0 32 32" to="360 32 32"
                      dur="2.6s" repeatCount="indefinite"/>
  </circle>
</svg>`;
  svg = svg.replace(/<\/svg>\s*$/, arc);

  // ---- 3. accessible label, only if there is none ----
  if (!/aria-label\s*=/.test(svg) && !/<title[\s>]/.test(svg)) {
    svg = svg.replace(/(<svg\b[^>]*?)(\/?>)/, `$1 role="img" aria-label="${t.label}"$2`);
  }

  // ---- 4. let it scale in the tab strip ----
  svg = svg.replace(/\swidth="64"\s+height="64"/, '');

  writeFileSync(t.file, svg);
  console.log(`OK    ${t.file}  -> animated, accent ${t.arc[1]}`);

  // Verify immediately rather than trusting the string surgery.
  const after = readFileSync(t.file, 'utf8');
  const problems = [];
  if (!/animateTransform/.test(after)) problems.push('no animateTransform after edit');

  // Proper comment extraction, not a loose `/<!--.*--.*-->/`.
  //
  // The loose version matched ACROSS comment boundaries and reported
  // "illegal -- inside an XML comment" on files `check-icon-svg.mjs` then passed
  // 24/24. A verifier that cries wolf gets deleted rather than fixed, and then the
  // real instance of the bug it was written for is unguarded.
  //
  // The rule is only ever violated INSIDE one comment, so match a comment and then
  // look inside it.
  for (const m of after.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (m[1].includes('--')) problems.push('illegal -- inside an XML comment');
  }
  const opens = (after.match(/<!--/g) ?? []).length;
  const closes = (after.match(/-->/g) ?? []).length;
  if (opens !== closes) problems.push(`${opens} '<!--' vs ${closes} '-->'`);

  if (!/aria-label\s*=/.test(after)) problems.push('no aria-label after edit');
  if ((after.match(/<svg[\s>]/g) ?? []).length !== 1) problems.push('not exactly one <svg> root');
  if (problems.length) {
    console.error(`      VERIFY FAILED: ${problems.join('; ')}`);
    process.exitCode = 1;
  }
}

console.log('done — run tools/check-icon-svg.mjs to confirm');
