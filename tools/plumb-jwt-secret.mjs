// plumb-jwt-secret.mjs
//
// ONE-TIME repo edit, run and then kept as a record of why the change was needed.
//
// Adds `JWT_SECRET_KEY` to every compose service that has `AUTH_INTERNAL_URL` but
// no JWT secret - which is what the shared session gate (`@wideo11/ui/gate`) needs
// to verify the `wideo11_session` cookie's signature.
//
// WITHOUT IT THE GATES LOCK EVERYONE OUT. `createGate` fails CLOSED when the
// secret is absent, which is the correct behaviour for a security control and the
// worst possible behaviour for a forgotten environment variable. So the secret has
// to be plumbed BEFORE the gates are deployed, not after something 401s in
// production.
//
// Idempotent: an existing `JWT_SECRET_KEY` in the same service block is left
// alone. Running it twice changes nothing.
//
// Usage:  node tools/plumb-jwt-secret.mjs [--check]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const path = `${repo}docker-compose.yml`;
const checkOnly = process.argv.includes('--check');

const NOTE = [
  '# The shared session gate (@wideo11/ui/gate) verifies the `wideo11_session`',
  "# cookie's signature with this SAME secret auth-service signs with. Without it",
  '# the gate fails CLOSED and every route on this app returns 401 - the correct',
  '# failure, but only if the secret is actually plumbed. SSOT: .env',
];

const lines = readFileSync(path, 'utf8').split(/\r?\n/);

// Services that already have a secret are collected as we walk, so an insert
// earlier in the file cannot make a later block look like it has one.
const hasSecretAfter = new Set();
for (let i = 0; i < lines.length; i++) {
  const m = /^(\s*)JWT_SECRET_KEY:/.exec(lines[i]);
  if (m) hasSecretAfter.add(i);
}

/** Index of the service whose block contains line `i`, or -1. */
const serviceOf = (i) => {
  for (let j = i; j >= 0; j--) {
    const m = /^ {2}(\w[\w-]*):\s*$/.exec(lines[j]);
    if (m) return m[1];
  }
  return '(top level)';
};

const toInsert = [];
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*AUTH_INTERNAL_URL: http:\/\/auth-service:8085/.test(lines[i])) continue;

  // Already has one nearby, inside the same service block?
  let has = false;
  for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
    if (/^ {2}\w[\w-]*:\s*$/.test(lines[j])) break; // next service
    if (/^\s*JWT_SECRET_KEY:/.test(lines[j])) {
      has = true;
      break;
    }
  }
  if (!has) toInsert.push({ at: i, service: serviceOf(i) });
}

if (toInsert.length === 0) {
  console.log('every service with AUTH_INTERNAL_URL already has JWT_SECRET_KEY - nothing to do');
  process.exit(0);
}

console.log(`${toInsert.length} service(s) need the secret:`);
for (const t of toInsert) console.log(`  ${t.service} (line ${t.at + 1})`);

if (checkOnly) process.exit(1);

const out = [];
for (let i = 0; i < lines.length; i++) {
  out.push(lines[i]);
  const hit = toInsert.find((t) => t.at === i);
  if (!hit) continue;
  const indent = lines[i].replace(/^(\s*).*$/, '$1');
  for (const n of NOTE) out.push(indent + n);
  out.push(`${indent}JWT_SECRET_KEY: \${JWT_SECRET_KEY:?JWT_SECRET_KEY is required - the session gate cannot verify tokens without it}`);
}

writeFileSync(path, out.join('\n'));
console.log(`\nwritten: ${path}`);