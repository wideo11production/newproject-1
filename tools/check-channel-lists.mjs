#!/usr/bin/env node
// check-channel-lists.mjs
//
// Compares the CLOSED SETS that exist in three places, and the palette that
// exists in two.
//
// =============================================================================
// WHY THIS FILE IS NECESSARY RATHER THAN TIDY
// =============================================================================
//
// `channel_type` is enforced by:
//
//   - `model.ValidChannelType`            (Go map)     - what the API accepts
//   - migration 018's CHECK constraint     (SQL)        - what the database accepts
//   - `apps/web/src/lib/channel-types.ts`  (TypeScript) - what a creator can pick
//
// A closed set that is written down N times is ONE set only if the copies are
// compared. They are not automatically one set, and the divergence is not
// theoretical here: the browse page used to carry its OWN copy, and that copy
// contained
//
//     other: 'Other'
//
// which exists in none of the other two. So it was a label for a category that
// cannot exist, invented by a file nobody was watching.
//
// Each copy is individually reasonable. That is exactly what makes it drift.
//
// `brand_hue` has the same shape across `service.BrandPalette` (Go) and
// `lib/channel-brand.ts` (TypeScript), with the same reasoning: the Go side owns
// the write path and refuses a hue it does not offer; the TypeScript side owns the
// read path and degrades an unknown hue to the default. Duplication there is
// STRUCTURED - a wrong hue costs a wrong colour and never a broken page - but
// "degrades safely" is a reason to check, not a reason not to.
//
// =============================================================================
// HOW IT COMPARES
// =============================================================================
//
// By PARSING THE SOURCES, not by importing them.
//
// Importing the TypeScript needs a build; importing the Go needs a compiler; and
// a checker that cannot run on a machine without those tools is a checker nobody
// runs. The lists are literals in files with a stable shape, so reading the shape
// is both sufficient and the thing that can be done anywhere `node` runs.
//
// The parsing is deliberately strict. If a list stops being a parseable literal,
// this FAILS - it does not silently conclude the lists match because it found
// nothing in both. A checker that passes because it read zero items is worse than
// no checker.
//
// Usage:  node tools/check-channel-lists.mjs

import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let pass = 0;
const fails = [];
const check = (label, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`, detail ? JSON.stringify(detail) : '');
  } else {
    fails.push(label);
    console.log(`FAIL  ${label}`, detail ? JSON.stringify(detail) : '');
  }
};

const read = (rel) => readFileSync(ROOT + rel.replace(/^\//, ''), 'utf8');

// ---------------------------------------------------------------------------
// 1. Channel categories: Go <-> SQL <-> TypeScript
// ---------------------------------------------------------------------------

/**
 * The `ValidChannelType` map, from `internal/model/creator.go`.
 *
 * Parsed from the Go source rather than imported so this file runs anywhere.
 *
 * The map is written as CONSTANT NAMES, not string literals:
 *
 *     ValidChannelType = map[string]bool{
 *         ChannelTypeGaming: true, ChannelTypeMusic: true, ...
 *     }
 *
 * so matching quoted strings finds nothing. The const block above it has the
 * values:
 *
 *     ChannelTypeGaming = "gaming"
 *
 * Both halves are resolved. Matching only the constant names would compare
 * identifiers rather than values, which is the check that cannot fail and
 * therefore proves nothing.
 */
function goChannelTypes() {
  const src = read('services/auth-service/internal/model/creator.go');

  const consts = new Map();
  for (const m of src.matchAll(/\b(ChannelType\w+)\s*=\s*"([a-z_]+)"/g)) {
    consts.set(m[1], m[2]);
  }
  if (consts.size === 0) {
    throw new Error('could not find the ChannelType* constants in internal/model/creator.go');
  }

  const block = /ValidChannelType\s*=\s*map\[string\]bool\{([\s\S]*?)\n\t\}/.exec(src);
  if (!block) {
    throw new Error('could not find ValidChannelType in internal/model/creator.go');
  }

  const names = [...block[1].matchAll(/(ChannelType\w+)\s*:/g)].map((m) => m[1]);
  const values = names.map((n) => {
    const v = consts.get(n);
    if (v === undefined) {
      throw new Error(`ValidChannelType references ${n}, which has no string value`);
    }
    return v;
  });
  if (values.length === 0) {
    throw new Error('ValidChannelType parsed as empty');
  }
  return values;
}

/**
 * The CHECK constraint's allowed values, from migration 018.
 *
 * Read from the SQL because the database is the LAST authority: anything the
 * application accepts but the constraint rejects fails at insert time with an
 * error that looks like a server fault.
 *
 * The `IN (...)` list SPANS SEVERAL LINES in that file, and a single-line pattern
 * finds nothing - which is how the first version of this check failed with
 * "could not find chk_channel_type" against a file that plainly contains it.
 */
function sqlChannelTypes() {
  const src = read('services/auth-service/migrations/018_channel_creation_fields.sql');
  const block = /chk_channel_type\s+CHECK\s*\([\s\S]*?\bIN\s*\(([\s\S]*?)\)/.exec(src);
  if (!block) {
    throw new Error('could not find chk_channel_type in migration 018');
  }
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * The picker values, from `lib/channel-types.ts`.
 *
 * Matched on the `value:` property of each entry rather than on the whole
 * literal, so the labels and hints can be reworded freely.
 */
function tsChannelTypes() {
  const src = read('apps/web/src/lib/channel-types.ts');
  return [...src.matchAll(/\{\s*value:\s*'([a-z_]+)',\s*label:/g)].map((m) => m[1]);
}

/** Sorted, de-duplicated - order and duplicates are not part of the contract. */
const norm = (xs) => [...new Set(xs)].sort();

const go = goChannelTypes();
const sql = sqlChannelTypes();
const ts = tsChannelTypes();

check('the Go map was parsed and is not empty', go.length > 0, { count: go.length });
check('the SQL constraint was parsed and is not empty', sql.length > 0, { count: sql.length });
check('the TypeScript list was parsed and is not empty', ts.length > 0, { count: ts.length });

check(
  'Go accepts exactly what SQL accepts',
  JSON.stringify(norm(go)) === JSON.stringify(norm(sql)),
  {
    onlyInGo: norm(go).filter((x) => !norm(sql).includes(x)),
    onlyInSql: norm(sql).filter((x) => !norm(go).includes(x)),
  }
);

check(
  'the picker offers exactly what the API accepts',
  JSON.stringify(norm(ts)) === JSON.stringify(norm(go)),
  {
    onlyInPicker: norm(ts).filter((x) => !norm(go).includes(x)),
    onlyInGo: norm(go).filter((x) => !norm(ts).includes(x)),
  }
);

// A category offered in the UI that the database refuses is the worst case: a
// creator picks it, the form looks like it worked, and the failure appears as a
// 500 at the moment they hit save.
check(
  'no picker entry is a category the DATABASE would reject',
  norm(ts).every((t) => norm(sql).includes(t)),
  { rejectedByDatabase: norm(ts).filter((t) => !norm(sql).includes(t)) }
);

// ---------------------------------------------------------------------------
// 2. Brand palette: Go <-> TypeScript
// ---------------------------------------------------------------------------

function goHues() {
  const src = read('services/auth-service/internal/service/channel_setup.go');
  const block = /BrandColors\s*=\s*\[\]BrandPalette\{([\s\S]*?)\n\}/.exec(src);
  if (!block) {
    throw new Error('could not find BrandColors in internal/service/channel_setup.go');
  }
  return [...block[1].matchAll(/Hue:\s*(\d+)/g)].map((m) => Number(m[1]));
}

function tsHues() {
  const src = read('apps/web/src/lib/channel-brand.ts');
  const block = /BRAND_COLORS:\s*BrandColor\[\]\s*=\s*\[([\s\S]*?)\n\];/.exec(src);
  if (!block) {
    throw new Error('could not find BRAND_COLORS in lib/channel-brand.ts');
  }
  return [...block[1].matchAll(/hue:\s*(\d+)/g)].map((m) => Number(m[1]));
}

const goPalette = goHues();
const tsPalette = tsHues();

check('the Go palette was parsed and is not empty', goPalette.length > 0, {
  count: goPalette.length,
});
check('the TypeScript palette was parsed and is not empty', tsPalette.length > 0, {
  count: tsPalette.length,
});

check(
  'the picker paints exactly the colours the server offers',
  JSON.stringify(norm(goPalette)) === JSON.stringify(norm(tsPalette)),
  {
    onlyInGo: norm(goPalette).filter((x) => !norm(tsPalette).includes(x)),
    onlyInTs: norm(tsPalette).filter((x) => !norm(goPalette).includes(x)),
  }
);

// Every hue must be inside the range the CHECK constraint enforces, on both
// sides. A value outside it is refused at the database - which is correct - and
// also unselectable, which is a bug in a palette entry.
const outOfRange = norm(goPalette).filter((h) => h < 0 || h > 359);
check('every offered hue is inside the CHECK constraint range 0-359', outOfRange.length === 0, {
  outOfRange,
});

// NO duplicate hues. Two entries with the same hue means one is unreachable, and
// the picker shows a swatch that does nothing.
const dupes = norm(goPalette).filter((h, i, a) => a.indexOf(h) !== i);
check('no hue is offered twice', dupes.length === 0, { duplicates: dupes });

// ---- WHY THERE IS NO CHECK THAT HUE 0 IS OFFERED ----
//
// This file originally asserted it, on the reasoning that "hue 0 (red) is a real
// choice and must not be read as unset".
//
// The premise is wrong, and the reason it is wrong is the interesting part: hue 0
// does not need to be in the palette for "unset" to be distinguishable from it.
// The distinction is made by `brand_hue_is_null`, which is a SEPARATE FLAG.
//
// Without that flag, the only way to say "no colour" would be to send null, and
// null decodes to 0, and 0 is Ember-adjacent - so clearing and choosing red would
// be the same request. That is a real bug, and it was fixed by the flag rather
// than by adding hue 0 to the palette.
//
// The palette's lowest is 8 (Ember). A creator who wants red picks Ember; hue 0
// and hue 8 are not distinguishable by eye, so omitting it costs nothing.
//
// So the check that matters is that the CLEAR PATH exists and is explicit:
//
//     brand_hue: null  +  brand_hue_is_null: true   ->  platform default
//     brand_hue: 268                                ->  Violet
//
// Two different requests, two different results, and a caller cannot confuse them
// by omitting a field.
const clearPath = read('apps/web/src/app/dashboard/channels/setup/page.tsx');
check(
  'the client can CLEAR a chosen colour with an explicit flag, not by omitting it',
  /brand_hue_is_null/.test(clearPath),
  { hint: 'brand_hue + brand_hue_is_null must be sent together; null alone is indistinguishable from a value' }
);
check(
  'the server distinguishes a cleared hue from an absent one',
  /BrandHueIsNull/.test(read('services/auth-service/internal/model/channel_setup.go')) &&
    /BrandHueIsNull/.test(read('services/auth-service/internal/service/channel_setup.go')),
  {}
);

// ---------------------------------------------------------------------------
// 3. The default hue must resolve on both sides
// ---------------------------------------------------------------------------
const goDefault = /DefaultBrandHue\s*=\s*(\d+)/.exec(
  read('services/auth-service/internal/service/channel_setup.go')
)?.[1];
const tsDefault = /DEFAULT_BRAND_HUE\s*=\s*(\d+)/.exec(read('apps/web/src/lib/channel-brand.ts'))?.[1];

check(
  'the default hue is defined on both sides',
  goDefault !== undefined && tsDefault !== undefined,
  { goDefault, tsDefault }
);
check(
  'the default hue is the SAME on both sides',
  goDefault === tsDefault,
  { goDefault, tsDefault }
);
check(
  'the default hue is one the palette actually offers',
  goDefault !== undefined && norm(goPalette).includes(Number(goDefault)),
  { defaultHue: goDefault, offered: norm(goPalette) }
);

// ---------------------------------------------------------------------------
// 4. Visibility, for the same reason: three states, written down three times
// ---------------------------------------------------------------------------
function goVisibility() {
  const src = read('services/auth-service/internal/model/channel_setup.go');
  const block = /ValidVisibility\s*=\s*map\[string\]bool\{([\s\S]*?)\n\}/.exec(src);
  if (!block) throw new Error('could not find ValidVisibility in internal/model/channel_setup.go');

  // The map is written as `VisibilityPublic: true`, so the constant name has to be
  // resolved. Matching identifiers instead of values would compare two files that
  // are trivially identical and prove nothing.
  const consts = new Map();
  for (const m of src.matchAll(/\bVisibility(\w+)\s*=\s*"([a-z]+)"/g)) {
    consts.set(`Visibility${m[1]}`, m[2]);
  }
  return [...block[1].matchAll(/(Visibility\w+)\s*:/g)]
    .map((m) => consts.get(m[1]))
    .filter(Boolean);
}

function tsVisibility() {
  const src = read('apps/web/src/app/dashboard/channels/setup/page.tsx');
  const block = /const VISIBILITIES[\s\S]*?\n\];/.exec(src);
  if (!block) throw new Error('could not find VISIBILITIES in the setup page');
  return [...block[0].matchAll(/value:\s*'([a-z]+)'/g)].map((m) => m[1]);
}

const goVis = goVisibility();
const tsVis = tsVisibility();

check('the Go visibility set was parsed and has three states', goVis.length === 3, {
  states: norm(goVis),
});
check('the setup screen offers all three', tsVis.length === 3, { offered: norm(tsVis) });
check(
  'the setup screen offers exactly what the API accepts',
  JSON.stringify(norm(tsVis)) === JSON.stringify(norm(goVis)),
  { api: norm(goVis), offered: norm(tsVis) }
);

// "unlisted" is the state that a boolean cannot express, and the reason this set
// has three members rather than two. Asserted so it cannot quietly become
// `{public, private}` in a future simplification.
check(
  '`unlisted` still exists - it is shareable by link but unlisted, which no boolean expresses',
  norm(goVis).includes('unlisted'),
  { states: norm(goVis) }
);

// And the SQL constraint has to agree, since it is what actually refuses the write.
function sqlVisibility() {
  const src = read('services/auth-service/migrations/022_channel_setup_step2.sql');
  const block = /chk_channel_visibility[\s\S]*?IN\s*\(([^)]*)\)/.exec(src);
  if (!block) throw new Error('could not find chk_channel_visibility in migration 022');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}
const sqlVis = sqlVisibility();
check(
  'the SQL constraint accepts exactly the three states',
  JSON.stringify(norm(sqlVis)) === JSON.stringify(norm(goVis)),
  { sql: norm(sqlVis), api: norm(goVis) }
);

console.log(`\n${pass}/${pass + fails.length} checks passed`);
console.log(fails.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails.length})`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length ? 1 : 0);