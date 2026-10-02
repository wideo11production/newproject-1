#!/usr/bin/env node
// add-liveness.mjs
//
// ONE-TIME repo edit, kept as the record of why these routes exist.
//
// Adds a minimal unauthenticated `GET /api/live` to the six apps whose session
// gate now refuses every route, and points each container health check at it.
//
// =============================================================================
// WHY THIS IS NECESSARY, AND WHY IT IS NOT A COMPROMISE
// =============================================================================
//
// Six containers went unhealthy the moment their gates started working, with:
//
//     wget: server returned error: HTTP/1.1: 401 Unauthorized
//
// because the health check was probing `/`:
//
//     wget --spider -q http://127.0.0.1:3001/ || exit 1
//
// That is the gate working CORRECTLY. A liveness probe is not a user request: it
// is Docker asking "has this process started and is it still serving?", and it
// carries no session because there is nobody to log in as. Answering it with 401
// makes Docker kill a perfectly healthy app after `retries` failures.
//
// The tempting fix is to let `/` through for localhost. That is the wrong one:
// "is this request from this container" is not a thing the gate can know, and a
// route that is open to anyone who can spoof a loopback header is not a route.
//
// So the probe gets its own route, marked public in the app's gate configuration,
// and it says the ONE thing a liveness probe should say.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//
//   - no database query. A liveness probe that checks the database reports the
//     DATABASE as unhealthy, and Docker restarts the app to fix a problem it
//     cannot fix. Readiness is a different endpoint and a different concern.
//   - no dependency checks, no version, no build id. Anything that changes makes
//     the probe flap for a reason unrelated to "is this process alive".
//   - no secret, no identifier, no hostname.
//
// So it leaks nothing, and `tools/check-app-gates.mjs` asserts it is reachable
// WITHOUT a credential - which is the point of it existing.
//
// Usage:  node tools/add-liveness.mjs [--check]

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const checkOnly = process.argv.includes('--check');

/** The six apps whose gates now refuse everything, with their route root. */
const APPS = [
  // `dir` is where `app/` lives. `monitor`, `admin`, `currency` and `superadmin`
  // use `src/app`; `billing` and `analytics` use a root-level `app/`.
  { name: 'monitor', dir: 'apps/monitor/src', compose: 'monitor', port: 3001 },
  { name: 'admin', dir: 'apps/admin/src', compose: 'admin', port: 3004 },
  { name: 'currency', dir: 'apps/currency/src', compose: 'currency-app', port: 3007 },
  { name: 'billing', dir: 'apps/billing', compose: 'billing', port: 3003 },
  { name: 'analytics', dir: 'apps/analytics', compose: 'analytics', port: 3005 },
  { name: 'superadmin', dir: 'apps/superadmin/src', compose: 'superadmin-app', port: 3008 },
];

const ROUTE = `import { NextResponse } from 'next/server';

/**
 * LIVENESS PROBE - "is this process alive and serving?"
 *
 * =============================================================================
 * WHY THIS ROUTE EXISTS
 * =============================================================================
 *
 * Every app here runs behind a session gate, so EVERY route answers 401 without a
 * credential - including \`/\`. Docker's health check was probing \`/\`:
 *
 *     wget --spider -q http://127.0.0.1:PORT/ || exit 1
 *
 * and the six containers went unhealthy within one health interval:
 *
 *     wget: server returned error: HTTP/1.1: 401 Unauthorized
 *
 * The gate was right. A liveness probe is not a user request - it is Docker asking
 * whether the process started and is still serving, and there is nobody to log in
 * as. Answering 401 makes Docker kill a healthy app after \`retries\` failures.
 *
 * The tempting shortcut is to exempt \`/\` for loopback. That is not available and
 * would be wrong anyway: "is this request from this container" is not something the
 * gate can know, and a route open to anything carrying a spoofable loopback header
 * is not a route.
 *
 * =============================================================================
 * WHAT THIS DELIBERATELY DOES NOT RETURN
 * =============================================================================
 *
 *   NO DATABASE QUERY. A liveness probe that checks the database reports the
 *   DATABASE as unhealthy, and Docker restarts the app to fix something it cannot
 *   fix. Whether the app is READY to take traffic is a separate question with a
 *   separate endpoint.
 *
 *   NO dependencies, NO version, NO build id, NO hostname, NO uptime. Anything
 *   that can change makes the probe flap for a reason unrelated to "is this alive".
 *
 * So it leaks nothing beyond the fact that a process is on this port - which is
 * also what an open TCP port already says.
 *
 * It is listed as a public path in this app's \`middleware.ts\`, and
 * \`tools/check-app-gates.mjs\` asserts it is reachable WITHOUT a credential.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'ok' },
    // Never cached. A cached 200 that outlives the process is a probe that passes
    // for a container that is not running.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
`;

let changed = 0;
for (const app of APPS) {
  const dir = `${repo}${app.dir}/app/api/live`;
  const file = `${dir}/route.ts`;
  if (existsSync(file)) {
    console.log(`  ${app.name}: already has ${app.dir}/app/api/live/route.ts`);
    continue;
  }
  if (checkOnly) {
    console.log(`  ${app.name}: MISSING ${app.dir}/app/api/live/route.ts`);
    changed++;
    continue;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, ROUTE);
  console.log(`  ${app.name}: wrote ${app.dir}/app/api/live/route.ts`);
  changed++;
}

// ---------------------------------------------------------------------------
// Point each health check at it
// ---------------------------------------------------------------------------
const composePath = `${repo}docker-compose.yml`;
const lines = readFileSync(composePath, 'utf8').split(/\r?\n/);

let current = '';
const touched = [];
for (let i = 0; i < lines.length; i++) {
  const svc = /^ {2}([a-z0-9-]+):\s*$/.exec(lines[i]);
  if (svc) current = svc[1];

  const app = APPS.find((a) => a.compose === current);
  if (!app) continue;

  // Only the app's OWN healthcheck, never a dependency's.
  if (!/wget --spider -q http:\/\/127\.0\.0\.1:/.test(lines[i])) continue;

  // Preserve the line's own indentation.
  //
  // The first version hardcoded six spaces and the health check's `test:` value sits
  // at eight, which produced YAML like:
  //
  //         wget --spider -q http://127.0.0.1:3001/api/live || exit 1
  //           interval: 30s
  //
  // - a bare scalar followed by a mapping key, which is
  //   `mapping values are not allowed in this context`. The compose file was
  //   unparseable until this was fixed, and nothing else could even be started.
  const indent = lines[i].replace(/^(\s*).*$/, '$1');
  const replacement = `${indent}wget --spider -q http://127.0.0.1:${app.port}/api/live || exit 1`;
  if (lines[i] === replacement) continue;
  touched.push(`${current} (line ${i + 1})`);
  lines[i] = replacement;
}

if (checkOnly) {
  console.log(`\nhealth checks still pointing at \`/\`: ${touched.length ? touched.join(', ') : 'none'}`);
  process.exit(changed || touched.length ? 1 : 0);
}

writeFileSync(composePath, lines.join('\n'));
console.log(`\nhealth checks repointed to /api/live: ${touched.length ? touched.join(', ') : 'none needed'}`);