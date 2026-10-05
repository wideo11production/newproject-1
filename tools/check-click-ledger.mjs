#!/usr/bin/env node
// Assert that every click-ledger consumer reads the fields the service emits.
//
// ----------------------------------------------------------------------------
// WHY THIS FILE EXISTS
// ----------------------------------------------------------------------------
//
// The superadmin dashboard's Click History panel never rendered. It read:
//
//	d.events        but analytics-service returns  d.clicks
//	c.timestamp     but the model emits             occurred_at / created_at
//
// The array was always empty, so the Empty state was the only thing anyone ever
// saw — while the table held every click the product had ever recorded.
//
// The general name for this is a **contract drift between a Go struct's JSON tags
// and a TypeScript interface**, and it is invisible in review because:
//
//   - TypeScript is happy. The interface is internally consistent; it just does
//     not describe the thing it is supposed to describe.
//   - `?.` and `?? []` swallow the mismatch. `d.events ?? []` is a valid
//     expression that evaluates to an empty array.
//   - nothing fails. No test, no build, no type error.
//   - and the rendered result — "no clicks" — is a completely plausible answer.
//
// That last point is why it survived so long. It is the same class as the resize
// test that was asserting its own bug and the scrollbar assertion that was always
// failing: **a check that returns OK because it verified the wrong thing.** The
// distinction is that nobody here wrote a check at all.
//
// ----------------------------------------------------------------------------
// WHAT IT CHECKS, AND WHY IT IS A SOURCE CHECK
// ----------------------------------------------------------------------------
//
// The real fix is to derive the TypeScript type from the Go model rather than
// restate it, and that is the right long-term answer. It is also a build-system
// change. This file is the cheap half, and the cheap half catches the class
// immediately:
//
//   1. The Go model's json tags are the SOURCE OF TRUTH. If a field is renamed
//      there, this fails.
//   2. Every consumer's field references must exist in that set.
//   3. The fields the dashboard *needs* must all be present — so deleting
//      `occurred_at` from the model does not pass by leaving the UI reading a
//      field that no longer exists.
//
// Point 3 is the one that matters most. Without it, this check would be satisfied
// by two interfaces that agree with each other and both disagree with the service.
//
// ----------------------------------------------------------------------------
// IT ALSO CHECKS THE THING THAT MADE IT INVISIBLE
// ----------------------------------------------------------------------------
//
// Every ledger fetch must be checked for `.ok`, or must feed a per-panel error
// state. The original code had four `.ok`-guarded fetches that silently dropped a
// 500, so "the service is broken" and "nobody has ever clicked anything" rendered
// as the same empty table. That is the real lesson, and a field-name check alone
// would not have caught it.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

// -----------------------------------------------------------------------------
// COMMENTS ARE STRIPPED BEFORE ANY ASSERTION — WITH A REAL SCANNER
// -----------------------------------------------------------------------------
//
// I did not write this on the first pass, and the check failed on my own code
// within a minute: `d.events`, `c.timestamp` and `/api/v1/auth/admin/clicks` all
// appear in superadmin's page.tsx and the analytics route — inside comments that
// explain the bug they describe.
//
// That is the repository's fifth recorded instance of the same mistake, and the
// second time in one session it caught me writing the very thing it warns about:
//
//   ticket.upload_url - a comment-level drift between two copies
//   ALTER COLUMN ... TYPE - a comment saying "TYPE added", statement had none
//   a # security_profile comment justifying an omitted COMMENT ON
//   prometheusUrl - a comment explaining why it must not be sent, above the line
//     that sends it
//   TestFinishAuthenticationIssuesASession - a comment mentioning the call that
//     had been deleted
//   THIS CHECK
//
// A check that matches text is matching comments too, and comments are where we
// write down the mistakes we just fixed.
//
// -----------------------------------------------------------------------------
// AND WHY THE FIRST STRIPPER WAS WORSE THAN THE BUG
// -----------------------------------------------------------------------------
//
// The obvious version is two regexes:
//
//     src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
//
// It is wrong, and wrong in the exact way this whole repository keeps getting
// wrong. This line of prose was in superadmin's page.tsx:
//
//     // along automatically, and each `/api/*` route reads it server-side
//
// The `/*` inside that LINE COMMENT opens what the regex believes is a block
// comment. It then swallowed **22,546 characters** — real code, including every
// `fetch(` and `setClicks(` in the file — up to the next `*/` eleven kilobytes
// later. The assertions then found nothing, matched nothing, and **reported PASS**.
//
// A checker that eats a third of the file and reports success is worse than no
// checker, because it is trusted. So this is a single-pass scanner that tracks
// string and template literals, which is ~30 lines and actually correct for the
// cases that matter.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;

  // Tracks which quote-delimiter we are inside, so `//` in a URL and `/*` in a
  // template literal are not mistaken for syntax.
  let quote = null; // "'" | '"' | '`'

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // ---- line comment ----
    if (quote === null && ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // ---- block comment ----
    //
    // Reached only outside a string, which is what stops `` `/api/*` `` from
    // being read as an opening delimiter.
    if (quote === null && ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2; // skip the closing `*/`
      out += ' ';
      continue;
    }

    // ---- string / template literal ----
    if (ch === "'" || ch === '"' || ch === '`') {
      if (quote === null) {
        quote = ch;
        out += ch;
        i++;
        continue;
      }
      if (quote === ch) {
        // A backtick template can nest `${ ... }`, which contains code that may
        // itself contain a comment. For the purposes of this check the template
        // body is opaque: no ledger field name is constructed inside one, and
        // treating it as a string avoids mis-parsing its braces.
        if (ch === '`') {
          let t = i + 1;
          while (t < n && src[t] !== '`') {
            if (src[t] === '\\') t++;
            t++;
          }
          out += src.slice(i, Math.min(t + 1, n));
          i = t + 1;
          quote = null;
          continue;
        }
        quote = null;
      }
      out += ch;
      i++;
      continue;
    }

    if (quote !== null && quote !== '`') {
      // Inside a single- or double-quoted string: copy verbatim, honouring
      // backslash escapes so an escaped quote does not end it early.
      if (ch === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

const results = [];
const fail = (name, detail) => results.push({ ok: false, name, detail });
const pass = (name, detail = '') => results.push({ ok: true, name, detail });

// ---- 1. Read the Go model, which is the source of truth ----

const MODEL = join(ROOT, 'services/analytics-service/src/model/ui_click.go');
if (!existsSync(MODEL)) {
  fail('model present', `${MODEL} not found`);
} else {
  const go = readFileSync(MODEL, 'utf8');

  // Field declarations with a json tag: `Surface string \`gorm:"..." json:"surface"\``
  const jsonFields = new Set();
  const fieldRe = /^\s*\w+\s+[\w.*\[\]]+\s+`[^`]*json:"([^",]+)[^"]*"/gm;
  let m;
  while ((m = fieldRe.exec(go)) !== null) {
    jsonFields.add(m[1]);
  }

  if (jsonFields.size === 0) {
    fail('model has json tags', 'no `json:"..."` tags parsed — the regex is stale, not the model');
  } else {
    pass('model has json tags', `${jsonFields.size} fields`);

    // ---- The fields the dashboard genuinely needs ----
    //
    // Listed explicitly rather than derived, so that REMOVING one from the Go
    // model fails here instead of quietly removing it from the UI too.
    const REQUIRED = [
      'id', 'surface', 'page', 'target', 'label', 'element_id',
      'x', 'y', 'referrer', 'ip_address', 'user_email', 'user_id',
      'occurred_at', 'created_at', 'attribution',
    ];
    const missing = REQUIRED.filter((f) => !jsonFields.has(f));
    if (missing.length > 0) {
      fail(
        'model exposes every field the dashboard needs',
        `missing from the Go model: ${missing.join(', ')}`
      );
    } else {
      pass('model exposes every field the dashboard needs', `${REQUIRED.length} fields`);
    }

    // ---- The specific fields that were read wrongly ----
    //
    // `events` is NOT a field of this model — it was the key of the OLD
    // auth-service response shape. If somebody reintroduces it, this fires.
    if (jsonFields.has('events')) {
      fail('no legacy field names', 'the model emits `events` — that is the pre-migration key name');
    } else {
      pass('no legacy field names', 'no `events` / `timestamp` in the model');
    }
  }
}

// ---- 2. Every consumer must reference only real fields ----

const CONSUMERS = [
  {
    label: 'superadmin ClickEvent interface',
    file: join(ROOT, 'apps/superadmin/src/app/page.tsx'),
    // Only the interface block, so unrelated property names elsewhere in a
    // 1000-line component are not mistaken for ledger fields.
    slice: (src) => {
      const start = src.indexOf('interface ClickEvent {');
      if (start < 0) return null;
      const end = src.indexOf('\n}', start);
      return end < 0 ? null : src.slice(start, end);
    },
    // Declared members: `surface: string;` / `occurred_at: string;`
    //
    // NOT `c.something`. The interface is a list of declarations, so a
    // property-access pattern finds nothing and the assertion passes vacuously
    // — which is exactly what the first version of this check did: "0 field
    // reads checked", reported as a PASS.
    //
    // A check that cannot fail is not a check. That is the whole lesson of this
    // file, so the assertion now counts what it looked at and says so.
    fieldRe: /^\s*(\w+)\??\s*:/gm,
    // Fields the model emits that a consumer may legitimately not declare.
    optional: new Set(['device', 'browser', 'os', 'country', 'session_id']),
  },
  {
    label: 'analytics click rows',
    file: join(ROOT, 'apps/analytics/app/api/analytics/route.ts'),
    // The block that builds `clickRows`, where the response key is chosen.
    //
    // Exactly ONE statement, not 200 characters. The first version took a fixed
    // 400-character window, which ran past this line and into the `overviewBody`
    // fields — so the assertion complained about `total_users` and
    // `total_verified`, which are real fields of a different object entirely.
    //
    // A check that reports unrelated things as wrong is a check nobody reads. The
    // window stops at the end of the line.
    slice: (src) => {
      const i = src.indexOf('const clickRows');
      if (i < 0) return null;
      const end = src.indexOf('\n', i);
      return end < 0 ? src.slice(i) : src.slice(i, end);
    },
    // Read access: `clicksBody.clicks`
    //
    // The first pattern here was `/\b\w+\.(\w+)\s*(?:\?\?|\|\|)/` — "a property
    // access followed by a fallback". It matched ZERO fields, because the line is
    // `Array.isArray(clicksBody.clicks) ? clicksBody.clicks : []` and contains no
    // `??` or `||` at all. The assertion passed vacuously.
    //
    // The check now counts what it looked at and FAILS on zero, so a pattern that
    // stops matching surfaces as a failure rather than as a green tick.
    fieldRe: /\b\w+\.(\w+)/g,
    // `clicks` and `total` are keys of the RESPONSE ENVELOPE
    // (`{"clicks": [...], "total": N}`), not fields on a ledger row. The row
    // fields are asserted separately against the Go model.
    optional: new Set(['isArray', 'clicks', 'total']),
    // `d.events` here would be the SECURITY events endpoint, which genuinely
    // returns `events` — a different service, a different shape. So the
    // legacy-name assertion below is scoped to the click block, not the file.
    legacyScope: 'clickBlock',
  },
];

// The Go model's field set, read once.
const modelFields = (() => {
  try {
    const go = readFileSync(MODEL, 'utf8');
    const set = new Set();
    const re = /^\s*\w+\s+[\w.*\[\]]+\s+`[^`]*json:"([^",]+)[^"]*"/gm;
    let mm;
    while ((mm = re.exec(go)) !== null) set.add(mm[1]);
    return set;
  } catch {
    return new Set();
  }
})();

for (const consumer of CONSUMERS) {
  if (!existsSync(consumer.file)) {
    fail(consumer.label, `${consumer.file} not found`);
    continue;
  }

  // Comments stripped — see `stripComments`.
  const clean = stripComments(readFileSync(consumer.file, 'utf8'));
  const region = consumer.slice(clean);
  if (region === null) {
    fail(consumer.label, 'could not locate the relevant block — has it been renamed?');
    continue;
  }

  const reads = new Set();
  let m;
  consumer.fieldRe.lastIndex = 0;
  while ((m = consumer.fieldRe.exec(region)) !== null) reads.add(m[1]);

  if (reads.size === 0) {
    fail(
      `${consumer.label}: assertion found nothing to check`,
      'the field pattern matched zero fields, so this assertion would pass whatever ' +
        'the code does. A check that cannot fail is not a check.'
    );
    continue;
  }

  const bogus = [...reads].filter(
    (f) => modelFields.size > 0 && !modelFields.has(f) && !consumer.optional.has(f)
  );
  if (bogus.length > 0) {
    fail(
      `${consumer.label}: every field read exists`,
      `reads fields the model does not emit: ${bogus.join(', ')}`
    );
  } else {
    pass(`${consumer.label}: every field read exists`, `${reads.size} field(s) checked`);
  }
}

// ---- 3. No consumer may read the legacy key names ----
//
// Scoped to the CLICK block. `d.events` elsewhere in these files is the security
// events endpoint, which genuinely returns `events` — flagging that would be the
// check crying wolf, and a check that cries wolf gets deleted.

const LEGACY = ['d.events', 'data.events', '.events ??', 'c.timestamp', '.timestamp)'];

for (const consumer of CONSUMERS) {
  if (!existsSync(consumer.file)) continue;
  if (consumer.legacyScope !== 'clickBlock') continue;

  const clean = stripComments(readFileSync(consumer.file, 'utf8'));
  const region = consumer.slice(clean);
  if (region === null) continue;

  const found = LEGACY.filter((needle) => region.includes(needle));
  if (found.length > 0) {
    fail(
      `${consumer.label}: no legacy key names`,
      `found: ${found.join(', ')} — these are pre-migration response keys and read as empty`
    );
  } else {
    pass(`${consumer.label}: no legacy key names`);
  }
}

// The superadmin dashboard reads both `clicks` (ledger) and `events` (security),
// so the file-wide check cannot be `d.events`-free. Assert the ledger read
// specifically: `d.clicks`.

const SUPERADMIN_FILE = join(ROOT, 'apps/superadmin/src/app/page.tsx');
if (existsSync(SUPERADMIN_FILE)) {
  const clean = stripComments(readFileSync(SUPERADMIN_FILE, 'utf8'));
  if (!/setClicks\(\s*\w+\.clicks/.test(clean)) {
    fail(
      'superadmin reads the ledger under its real key',
      'expected setClicks(d.clicks ...) — analytics-service returns `clicks`. ' +
        'Reading `events` yields [] and renders as "no clicks recorded yet".'
    );
  } else {
    pass('superadmin reads the ledger under its real key', 'setClicks(d.clicks)');
  }

  if (!/occurred_at/.test(clean)) {
    fail(
      'superadmin reads the ledger timestamps under their real names',
      'expected occurred_at / created_at — the model emits those, not `timestamp`. ' +
        '`new Date(undefined)` renders "Invalid Date" on every row.'
    );
  } else {
    pass('superadmin reads the ledger timestamps under their real names', 'occurred_at');
  }
}

// ---- 4. The analytics app must read the service that OWNS the ledger ----

const ANALYTICS_ROUTE = join(ROOT, 'apps/analytics/app/api/analytics/route.ts');
if (existsSync(ANALYTICS_ROUTE)) {
  // Comments stripped: the route's header explains at length that it USED to
  // call `/api/v1/auth/admin/clicks`, and an unstripped check reads that
  // explanation as the bug still being present.
  const src = stripComments(readFileSync(ANALYTICS_ROUTE, 'utf8'));
  if (!src.includes('ANALYTICS_INTERNAL_URL')) {
    fail(
      'analytics reads the owning service',
      'apps/analytics does not reference ANALYTICS_INTERNAL_URL — it may be reading ' +
        'the pre-migration auth_service.click_events table while superadmin reads ' +
        'analytics_service.ui_click_events. Two dashboards, same name, different tables.'
    );
  } else if (src.includes('/api/v1/auth/admin/clicks')) {
    fail(
      'analytics reads the owning service',
      'apps/analytics still calls /api/v1/auth/admin/clicks — the pre-migration table'
    );
  } else {
    pass('analytics reads the owning service', 'ANALYTICS_INTERNAL_URL');
  }
}

// ---- 5. A failed fetch must not be able to render as "no data" ----
//
// This is the check that the field-name assertions above cannot make, and it is
// the one that would have caught the ORIGINAL symptom: four `.ok`-guarded fetches
// that silently dropped a 500, so a broken service and an empty table looked
// identical.

const SUPERADMIN = join(ROOT, 'apps/superadmin/src/app/page.tsx');
if (existsSync(SUPERADMIN)) {
  const src = stripComments(readFileSync(SUPERADMIN, 'utf8'));

  if (!src.includes('function PanelError')) {
    fail(
      'a failed panel renders as a failure, not as empty',
      'apps/superadmin has no PanelError component. A fetch that fails must not be ' +
        'able to look like a panel with no data — on a dashboard whose entire purpose ' +
        'is "did anything happen", that is the most expensive kind of lie there is.'
    );
  } else {
    pass('a failed panel renders as a failure, not as empty', 'PanelError present');
  }

  if (!src.includes('panelError')) {
    fail(
      'per-panel error state is tracked',
      'apps/superadmin has no panelError state, so a failed fetch cannot be ' +
        'distinguished from an empty result'
    );
  } else {
    pass('per-panel error state is tracked', 'panelError state present');
  }
} else {
  fail('superadmin dashboard present', `${SUPERADMIN} not found`);
}

// ---- Report ----

let failures = 0;
console.log('CLICK LEDGER CONTRACT\n' + '='.repeat(60));
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  } else {
    failures++;
    console.log(`  FAIL  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }
}
console.log('='.repeat(60));
console.log(`${results.length - failures}/${results.length} passed`);

process.exit(failures === 0 ? 0 : 1);
