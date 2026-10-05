// Do the app icons actually PARSE as SVG, and do they actually ANIMATE?
//
// -----------------------------------------------------------------------------
// WHY A STANDALONE CHECK, WHEN check-tab-icon.mjs ALREADY COVERS THIS
// -----------------------------------------------------------------------------
//
// Because `check-tab-icon.mjs` needs a running browser, and the failure it is
// guarding against is a plain authoring mistake that a 5-line parser check catches
// in milliseconds on any machine. A bug that ships because the test that would
// have caught it needed Chrome is a bug that ships again.
//
// -----------------------------------------------------------------------------
// THE BUG THIS EXISTS FOR
// ------------------------------------------------------------------------------
//
// The superadmin icon carried an XML comment written with `-----` underline rows.
// XML forbids `--` ANYWHERE inside a comment, so the browser's parser hit the
// second hyphen and rejected the ENTIRE document:
//
//     This page contains the following errors:
//     error on line 5 at column 5: Comment must not contain '--' (double-hyphen)
//
// The file was served with `HTTP 200` and `content-type: image/svg+xml`. Both
// looked correct. `tsc --noEmit` passed. The file was 4,870 bytes and contained an
// `<animateTransform>`.
//
// And the browser rendered nothing at all - not a broken image, not a static icon:
// no icon. Which is exactly what "that is just a placeholder, isn't it" describes,
// and exactly what no amount of reading the source would have revealed, because the
// source is valid-looking and the file is well-formed by every measure except the
// one that matters.
//
// The only things that caught it were asking the browser to parse it and printing
// the parser's own complaint.
//
// THE RULE
//
//   1. The file must parse as `image/svg+xml` with no `parsererror`.
//   2. It must contain at least one animation element, or the "animated" claim in
//      its filename-adjacent documentation is false.
//   3. It must have a `<title>` or `aria-label`, so the tab is not an unlabelled
//      icon for anyone using a screen reader.
//
// (1) is the one that would have caught it, and it needs no browser.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Find every icon.svg in the repo, so a new app cannot ship a broken one by not
 * being in a hardcoded list. Hardcoding is how the previous five-copies problem
 * started.
 */
function findIcons(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findIcons(full, found);
    else if (entry.name === 'icon.svg') found.push(full);
  }
  return found;
}

/**
 * The XML comment rules, enforced in plain JS.
 *
 * A real XML parser would be the obvious tool and would need a dependency. These
 * are two rules that account for every authoring mistake seen in practice, and
 * they are cheap.
 */
function commentViolations(svg) {
  const problems = [];
  const commentRe = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = commentRe.exec(svg)) !== null) {
    const body = m[1];
    const line = svg.slice(0, m.index).split('\n').length;

    // The rule that actually bit: `--` is illegal inside an XML comment.
    if (body.includes('--')) {
      problems.push(
        `line ${line}: comment contains "--", which is ILLEGAL inside an XML comment.\n` +
        `       The whole document fails to parse and the browser renders NO icon.\n` +
        `       This file served HTTP 200 with image/svg+xml and looked completely fine.\n` +
        `       Use a run of '=' for an underline instead.`
      );
    }
  }

  // A `<!--` with no closing `-->` swallows the rest of the file. Same outcome.
  const opens = (svg.match(/<!--/g) ?? []).length;
  const closes = (svg.match(/-->/g) ?? []).length;
  if (opens !== closes) {
    problems.push(
      `${opens} '<!--' vs ${closes} '-->' - an unclosed comment swallows the rest of the file.`
    );
  }
  return problems;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`);
};

const icons = findIcons(join(ROOT, 'apps'));
console.log(`ICON VALIDATION — ${icons.length} icon.svg file(s) found\n${'='.repeat(70)}`);

if (icons.length === 0) {
  check('icons exist', false, 'no icon.svg found anywhere under apps/');
} else {
  for (const file of icons) {
    const rel = file.replace(`${ROOT}/`, '').replace(/\\/g, '/');
    const svg = readFileSync(file, 'utf8');

    // ---- 1. XML comment legality ----
    const problems = commentViolations(svg);
    check(`${rel}: XML comments are legal`, problems.length === 0, problems.join('\n        '));

    // ---- 2. Brand-W icons MUST animate; bespoke ones need not ----
    //
    // The rule is conditional, and the condition is the shared brand gradient
    // `id="wg"`. Three apps draw the "W" mark and all three rotate an accent arc.
    // Two ship BESPOKE artwork - `monitor` a chart line, `video-editor` a camera -
    // and putting a rotating brand ring around an unrelated glyph reads as a mistake
    // AND moves for no reason. So they are static on purpose.
    //
    // The first version of this check asserted animation unconditionally and
    // reported two healthy static icons as failures. A check that demands a change
    // you do not want gets disabled, and then the case it was really written for -
    // a brand icon that silently stopped animating - is unguarded.
    const isBrandW = /id="wg"/.test(svg);
    const anims =
      (svg.match(/<animateTransform/g) ?? []).length +
      (svg.match(/<animate\b/g) ?? []).length +
      (svg.match(/<animateMotion/g) ?? []).length;

    if (isBrandW) {
      check(`${rel}: brand-W icon animates`, anims > 0, `${anims} found`);
    } else {
      check(`${rel}: bespoke icon (static by design)`, true, `brand=${isBrandW} anims=${anims}`);
    }

    // ---- 3. Single root element ----
    // Two roots is a parse error and the whole thing renders as nothing.
    const roots = (svg.match(/<svg[\s>]/g) ?? []).length;
    check(`${rel}: exactly one <svg> root`, roots === 1, `${roots} found`);

    // ---- 4. Labelled ----
    const labelled = /aria-label\s*=/.test(svg) || /<title[\s>]/.test(svg);
    // The detail is only meaningful on failure. The first version printed
    // "needs aria-label or <title>" unconditionally, so every PASS scrolled a
    // failure message past the reader - which trains people to stop reading the
    // detail column, and therefore to miss the one FAIL in it.
    check(`${rel}: has an accessible label`, labelled, labelled ? '' : 'needs aria-label or <title>');
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log('='.repeat(70));
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
