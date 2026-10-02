// Give every app the telemetry service's address and shared token.
//
// WHY
// ---
// The apps' shared audit handler forwards to `analytics-service` now, not to
// auth-service. Two env vars per app:
//
//   ANALYTICS_INTERNAL_URL    - compose-network address. Server-side only.
//   ANALYTICS_INTERNAL_TOKEN  - the shared secret. Server-side only.
//
// Both are SERVER-side. `NEXT_PUBLIC_*` would inline them into the browser
// bundle, and a secret in a browser bundle is a secret that has been published.
// The rule is simple: if it starts with NEXT_PUBLIC_, it is not a secret.
//
// Which apps get them
// -------------------
// Every app that mounts `GlobalActivityTracker`. That is all eight, including
// the editor and the currency app - an app with a tracker but no telemetry
// address produces events that go nowhere, which looks exactly like an app
// nobody uses.
//
// Usage:  node tools/wire-analytics-env.mjs
import fs from 'node:fs';

const P = 'docker-compose.yml';
const text = fs.readFileSync(P, 'utf8');
const lines = text.split('\n');

/** Apps that mount the tracker. Kept in step with the `check-surfaces` list. */
const APPS = [
  'web',
  'video-editor',
  'admin',
  'analytics',
  'billing',
  'monitor',
  'superadmin-app',
  'currency-app',
];

const BLOCK = [
  '      # ---- Click ledger: analytics-service ----',
  '      #',
  '      # SERVER-side vars. Never `NEXT_PUBLIC_*`: that prefix inlines the value',
  '      # into the browser bundle, and a shared secret in a bundle is published.',
  '      #',
  '      # The apps post to their OWN /api/audit route; that route reads the',
  '      # httpOnly session cookie and forwards here with the token attached. The',
  '      # browser never sees either value.',
  '      ANALYTICS_INTERNAL_URL: http://analytics-service:8091',
  '      ANALYTICS_INTERNAL_TOKEN: ${ANALYTICS_INTERNAL_TOKEN:?ANALYTICS_INTERNAL_TOKEN is required}',
];

const out = [];
let service = null;
let touched = 0;
const skipped = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const svc = line.match(/^  ([a-z][a-z0-9-]*):\s*$/);
  if (svc) service = svc[1];

out.push(line);

  if (!APPS.includes(service)) continue;

  // Per-service guard, NOT a global one. `out.some(...)` over the whole file
  // matched the analytics-service block - which legitimately contains
  // `ANALYTICS_INTERNAL_TOKEN` because it is the service that REQUIRES it - and
  // so it reported "already wired" for every app and inserted nothing. The
  // check has to be scoped to the block being edited.
  if (/^\s{6}ANALYTICS_INTERNAL_URL:/.test(line)) {
    skipped.push(`${service} (already wired)`);
    continue;
  }

  // Insert at the end of this service's `environment:` block, which is the last
  // line before the next key at a shallower indent.
  if (!/^    environment:\s*$/.test(line)) continue;

  // Walk forward to the end of the environment block.
  let end = i + 1;
  while (end < lines.length && !/^    [a-z]/.test(lines[end]) && !/^  [a-z]/.test(lines[end])) end++;
  if (end <= i + 1) {
    skipped.push(`${service} (empty environment block)`);
    continue;
  }

  out.push(...BLOCK);
  touched++;
  // Copy the rest of the block verbatim, then jump the loop there.
  for (let k = i + 1; k < end; k++) out.push(lines[k]);
  i = end - 1;
}

fs.writeFileSync(P, out.join('\n'));
console.log(`apps given analytics env: ${touched}/${Object.keys(APPS).length}`);
if (skipped.length) console.log('skipped: ' + skipped.join(', '));