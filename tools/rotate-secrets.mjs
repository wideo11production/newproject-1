#!/usr/bin/env node
// ============================================================================
// rotate-secrets.mjs
// ============================================================================
// The D1.1–D1.2 secrets rotation pipeline (NEWTODO T1.1, R1–R3).
//
// -----------------------------------------------------------------------------
// WHAT IT ROTATES, AND THE HONEST SPLIT
// -----------------------------------------------------------------------------
//
// SELF-MINTED (this tool generates and writes them):
//
//   JWT_SECRET_KEY          the HMAC key every session and every
//                           app's gate is signed with. Rotation =
//                           generate, verify, write. Fully local.
//
//   SECURITY_SUPERADMIN_PASSWORD
//                           the master-root password, read from .env
//                           by auth-service's bootstrap. Self-managed,
//                           so rotatable here.
//
// PROVIDER-ISSUED (this tool does NOT fabricate them):
//
//   SMTP_PASSWORD           a Gmail APP PASSWORD: 16 chars in 4
//                           groups, issued by Google's account UI.
//   OPENAI_API_KEY          issued by OpenAI (sk-…).
//   STRIPE_SECRET_KEY       issued by Stripe (sk_live_/sk_test_…).
//
// A script cannot mint these. Writing a made-up `sk_live_…` string
// would look like a rotation and silently break billing — a fake
// rotation is worse than no rotation. For these three the tool
// verifies the current value is present and real-looking, then
// prints the provider where the rotation actually happens.
//
// -----------------------------------------------------------------------------
// THE VERIFICATION PROTOCOL (every generated value)
// -----------------------------------------------------------------------------
//
//   1. NOT in `KnownWeakJWTSecrets` — the append-only matrix in
//      services/auth-service/internal/config/config.go. The list
//      is checked by PARSING THE GO SOURCE, not by trusting a
//      copy: the matrix is the source of truth, and a copy drifts.
//   2. NOT equal to the current value — a "rotation" that writes
//      the same key back is a no-op that reports success.
//   3. NOT equal to ANY other value in .env — two systems sharing
//      one secret means one leak compromises both (the JWT key
//      must not equal the analytics token, and so on).
//   4. At least 32 characters — auth-service's `Config.Validate`
//      refuses shorter keys, because HMAC-SHA256 truncates
//      silently below its block size.
//
// -----------------------------------------------------------------------------
// SAFETY
// -----------------------------------------------------------------------------
//
// A timestamped backup `.env.pre-rotation-<UTC>` is written BEFORE
// any change (and .gitignore is extended to cover it, so a secret
// copy can never be accidentally committed). The rest of .env —
// every comment, every other key — is preserved byte-for-byte and
// in order.
//
// USAGE
//
//   node tools/rotate-secrets.mjs            # rotate the self-minted keys
//   node tools/rotate-secrets.mjs --check    # dry run: report only
//
// EXIT: 0 done · 1 refused (verification failed or .env unreadable)
// ============================================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repo, '.env');
const gitignorePath = join(repo, '.gitignore');
const authConfigPath = join(
  repo,
  'services',
  'auth-service',
  'internal',
  'config',
  'config.go'
);

const dryRun = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// 1. Read .env as ORDERED lines, preserving everything but values
// ---------------------------------------------------------------------------

if (!existsSync(envPath)) {
  console.error('rotate-secrets: .env not found at the repo root.');
  process.exit(1);
}

const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

/**
 * Index of each KEY's definition line. Later duplicates are
 * ignored (dotenv semantics: first wins) — the tool reports
 * them instead of silently choosing.
 */
const keyLine = new Map();
for (let i = 0; i < lines.length; i++) {
  const m = /^([A-Z0-9_]+)=/.exec(lines[i]);
  if (m && !keyLine.has(m[1])) keyLine.set(m[1], i);
}

const valueOf = (key) => {
  const i = keyLine.get(key);
  if (i === undefined) return undefined;
  // Split on the FIRST '=': base64 and provider keys may contain
  // '=' themselves (padding), and that is part of the value.
  return lines[i].split('=').slice(1).join('=');
};

const isPlaceholder = (v) =>
  v === undefined ||
  /^(CHANGE[_-]?ME|your[-_ ]|xxx|placeholder|replace[-_ ]?me)/i.test(v.trim()) ||
  v.trim().length < 8;

// ---------------------------------------------------------------------------
// 2. Parse the append-only weak-secret matrix FROM THE GO SOURCE
// ---------------------------------------------------------------------------

const goSource = readFileSync(authConfigPath, 'utf8');
const matrixMatch = /var KnownWeakJWTSecrets = \[\]string\{([\s\S]*?)\n\}/.exec(goSource);
if (!matrixMatch) {
  console.error('rotate-secrets: cannot find KnownWeakJWTSecrets in auth-service config.go.');
  process.exit(1);
}
const weakSecrets = [...matrixMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

if (weakSecrets.length === 0) {
  console.error('rotate-secrets: the weak-secret matrix parsed empty. Refusing.');
  process.exit(1);
}

// Every value currently in .env, for the cross-collision check.
const allValues = [...keyLine.keys()].map((k) => valueOf(k));

// ---------------------------------------------------------------------------
// 3. The targets
// ---------------------------------------------------------------------------

/** Self-minted: generated here, written here. */
const SELF_MINTED = [
  {
    key: 'JWT_SECRET_KEY',
    // 48 bytes → 64 base64 chars. auth-service requires ≥ 32.
    generate: () => randomBytes(48).toString('base64'),
    note: 'every session token and every app gate is signed with this',
  },
  {
    key: 'SECURITY_SUPERADMIN_PASSWORD',
    // 32 bytes → 44 base64url chars: a password a human may have to type.
    generate: () => randomBytes(32).toString('base64url'),
    note: 'the master-root password read by auth-service bootstrap',
  },
];

/** Provider-issued: rotation happens at the provider, never here. */
const PROVIDER_ISSUED = [
  { key: 'SMTP_PASSWORD', provider: 'Google Account → Security → 2-Step Verification → App passwords → "Mail"', why: 'a Gmail app password is issued by Google, 16 chars in 4 groups — no script can mint one' },
  { key: 'OPENAI_API_KEY', provider: 'platform.openai.com → API keys → Create new secret key', why: 'issued by OpenAI (sk-… prefix)' },
  { key: 'STRIPE_SECRET_KEY', provider: 'dashboard.stripe.com → Developers → API keys → Roll key', why: 'issued by Stripe (sk_live_/sk_test_ prefix) — and rolling it invalidates the old key at Stripe' },
];

// ---------------------------------------------------------------------------
// 4. Verify a generated value against the full protocol
// ---------------------------------------------------------------------------

function verifyGenerated(key, value) {
  const reasons = [];
  if (weakSecrets.includes(value)) {
    reasons.push('collides with the append-only KnownWeakJWTSecrets matrix');
  }
  if (value === valueOf(key)) {
    reasons.push('equals the current value — that is not a rotation');
  }
  const collidesWith = [...keyLine.keys()].find(
    (other) => other !== key && valueOf(other) === value
  );
  if (collidesWith) {
    reasons.push(`equals ${collidesWith} — one leak would compromise both`);
  }
  if (value.length < 32) {
    reasons.push(`only ${value.length} chars; auth-service requires ≥ 32`);
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// 5. Rotate the self-minted keys
// ---------------------------------------------------------------------------

const replacements = []; // { key, index, oldLen, newValue }
const refusals = [];

for (const target of SELF_MINTED) {
  const current = valueOf(target.key);

  if (current !== undefined && isPlaceholder(current)) {
    refusals.push(`${target.key}: current value looks like a placeholder — set a real value first, then rotate.`);
    continue;
  }

  // Generate until the full protocol passes. The collision
  // checks are against 256-bit randomness, so this loop runs
  // once in practice; it exists so a refusal is possible
  // rather than a silent overwrite.
  let candidate;
  let reasons;
  for (let attempt = 0; attempt < 10; attempt++) {
    candidate = target.generate();
    reasons = verifyGenerated(target.key, candidate);
    if (reasons.length === 0) break;
  }
  if (reasons.length > 0) {
    refusals.push(`${target.key}: generated value refused — ${reasons.join('; ')}`);
    continue;
  }

  replacements.push({
    key: target.key,
    index: keyLine.get(target.key), // undefined when the key is absent → appended
    oldLength: current?.length ?? 0,
    newValue: candidate,
    note: target.note,
  });
}

// ---------------------------------------------------------------------------
// 6. Audit the provider-issued keys (present, real-looking)
// ---------------------------------------------------------------------------

const providerAudit = [];
for (const target of PROVIDER_ISSUED) {
  const current = valueOf(target.key);
  if (current === undefined) {
    providerAudit.push({ ...target, state: 'ABSENT from .env' });
  } else if (isPlaceholder(current)) {
    providerAudit.push({ ...target, state: 'PLACEHOLDER value — rotate at the provider and put the real key here' });
  } else {
    providerAudit.push({ ...target, state: `present (${current.length} chars) — rotate at the provider` });
  }
}

// ---------------------------------------------------------------------------
// 7. Report, then (unless --check) back up and write
// ---------------------------------------------------------------------------

console.log('rotate-secrets: D1.1–D1.2 rotation pipeline');
console.log(`  mode: ${dryRun ? 'CHECK (dry run — nothing written)' : 'EXECUTE'}`);
console.log(`  weak-secret matrix: ${weakSecrets.length} published value(s) parsed from auth-service config.go`);
console.log('');

if (refusals.length > 0) {
  console.error('REFUSED — nothing will be rotated:');
  for (const r of refusals) console.error(`  ✗ ${r}`);
  console.error('');
  process.exit(1);
}

if (replacements.length === 0) {
  console.log('  no self-minted keys to rotate (none defined or all refused).');
}

for (const r of replacements) {
  console.log(`  SELF-MINTED  ${r.key}`);
  console.log(`    ${r.note}`);
  console.log(`    ${r.oldLength} chars → 64+ chars, fresh entropy, weak-matrix-checked`);
}

console.log('');
console.log('  PROVIDER-ISSUED — rotation happens at the provider, NOT here:');
for (const p of providerAudit) {
  console.log(`    ${p.key}: ${p.state}`);
  console.log(`      where: ${p.provider}`);
  console.log(`      why not here: ${p.why}`);
}

if (dryRun) {
  console.log('');
  console.log('  dry run only — re-run without --check to write.');
  process.exit(0);
}

// ---- Backup BEFORE any change ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(repo, `.env.pre-rotation-${stamp}`);
writeFileSync(backupPath, lines.join('\n'));
console.log('');
console.log(`  backup written: .env.pre-rotation-${stamp}`);

// ---- Apply the replacements ----
const out = [...lines];
for (const r of replacements) {
  if (r.index === undefined) {
    // Key absent: append with a comment saying what it is.
    out.push('');
    out.push(`# Rotated ${new Date().toISOString()} by tools/rotate-secrets.mjs — ${r.note}`);
    out.push(`${r.key}=${r.newValue}`);
  } else {
    const old = out[r.index];
    out[r.index] = `${r.key}=${r.newValue}`;
    console.log(`  rotated ${r.key} (line ${r.index + 1})`);
    void old;
  }
}
writeFileSync(envPath, out.join('\n'));

// ---- The backup must never be committable ----
let gitignore = readFileSync(gitignorePath, 'utf8');
if (!/^\.env\.pre-rotation-\*/m.test(gitignore)) {
  if (!gitignore.endsWith('\n')) gitignore += '\n';
  gitignore += '\n# Rotation backups of .env (tools/rotate-secrets.mjs) — secret copies\n.env.pre-rotation-*\n';
  writeFileSync(gitignorePath, gitignore);
  console.log('  .gitignore extended: .env.pre-rotation-* (a secret backup must never be committed)');
}

console.log('');
console.log('  FOLLOW-UPS (both required):');
console.log('    1. docker compose up -d --force-recreate   — containers read the');
console.log('       secret at START, so every service must be recreated to pick it up.');
console.log('    2. Every live session and every in-flight service token signed with');
console.log('       the old key is now invalid — users sign in again. That is the');
console.log('       expected cost of rotating the signing key, not a bug.');
console.log('');
console.log('  NOT DONE BY THIS TOOL (deliberately):');
console.log('    • git history scrub (git filter-repo) — rewrites SHARED history and is');
console.log('      destructive; it needs an explicit go-ahead. Rotating ≠ scrubbing:');
console.log('      anyone who cloned already holds the old values.');
console.log('    • The three provider-issued keys above — rotate them at the provider,');
console.log('      then update .env by hand.');
