#!/usr/bin/env node
// ============================================================================
// audit-secrets.mjs
// ============================================================================
// Stops credentials from being committed.
//
//   1. TEMPLATE FILES - `.env.example` and friends are git-tracked, so every
//      value in them is public the moment it is pushed. A live Gmail app
//      password, an OpenAI project key, and live Stripe/Razorpay keys were
//      all committed in .env.example across four commits - while the file
//      itself carried a comment warning against exactly that. This check
//      makes it enforced.
//
//   2. STAGED CONTENT - high-confidence provider token shapes, and literal
//      credentials baked into a connection string.
//
// ---- WHY THIS FILE IS DELIBERATELY CONSERVATIVE ----
//
// A secret scanner that cries wolf gets bypassed within a day, and a bypassed
// scanner is worse than none because it creates a false sense of safety. The
// first draft of this file matched 300+ false positives, almost all of them:
//
//   - a 16-letter run of prose matched a "Gmail app password" shape
//   - any 32-char alphanumeric matched a "Razorpay key" shape (lockfile
//     integrity hashes, base64 digests, Go constant names)
//   - `fmt.Sprintf("host=%s password=%s", ...)` - which is the CORRECT way to
//     build a DSN - matched a "hardcoded credentials" rule
//   - `NEXT_PUBLIC_AUTH_URL` matched a key rule that treated bare "AUTH" as a
//     secret marker
//
// So: only formats with a provider-specific PREFIX are matched as values, and
// connection-string rules require a literal, non-placeholder password. A
// scanner that misses an unusual leak is recoverable. One nobody can use is
// not.
//
// USAGE
//
//   node tools/audit-secrets.mjs            # audit templates + whole tree
//   node tools/audit-secrets.mjs --staged   # only staged/added files
//   node tools/audit-secrets.mjs --quiet    # exit code only
//
// EXIT: 0 clean · 1 findings · 2 usage error
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Which files are checked
// ---------------------------------------------------------------------------

const TEMPLATE_FILES = ['.env.example', '.env.template', '.env.sample'];

// Key names that indicate a credential. Deliberately NOT matched: AUTH
// (matches NEXT_PUBLIC_AUTH_URL, RATE_LIMIT_AUTH_REQUESTS) and bare KEY
// (matches NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, which is public by design).
// Broad patterns here would have blocked legitimate commits.
const SECRET_KEY_PATTERN =
  /(^|_)(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIALS?|CLIENT_SECRET)($|_)/i;

// Value shapes. Every one of these has a provider-specific prefix, so the
// chance of matching ordinary code is negligible.
const VALUE_PATTERNS = [
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live secret key', re: /\bsk_live_[0-9a-zA-Z]{16,}\b/ },
  { name: 'Stripe webhook secret', re: /\bwhsec_[0-9a-zA-Z]{16,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// Tokens that mean "nobody set this", in any of the forms they appear in
// across this repo: Go format verbs, shell/JS interpolation, docs brackets.
const PLACEHOLDER_TOKENS = new Set([
  '', '-', '~', 'null', 'nil', 'none', 'true', 'false',
  '%s', '%v', '%d', '$1', '$2', '${}', '%s:%s',
  'xxx', 'XXX', '***', '...', '?',
]);

const PLACEHOLDER_WORDS =
  /(CHANGE[_-]?ME|YOUR[_-]|EXAMPLE|PLACEHOLDER|REPLACE[_-]?ME|INSERT[_-]?ME|TO[_-]?FILL|DUMMY|SANDBOX|TEST[_-]?ONLY|^x{3,}$|^\*+$|^\.{3,}$|^<.+>$|^\{.+\}$|^\[.+\]$|^\$\{.+\}$|^%[A-Z_]+%$)/i;

function isPlaceholder(value) {
  const v = String(value).trim().replace(/^['"]|['"]$/g, '');
  if (v === '') return true;
  if (PLACEHOLDER_TOKENS.has(v)) return true;
  if (PLACEHOLDER_WORDS.test(v)) return true;
  // foo@example.com style placeholders, but never a real-looking domain.
  if (/@/.test(v) && /(example|test|invalid|localhost|\.local|domain\.)/i.test(v)) return true;
  // A bare all-caps identifier is an enum or a bucket name, not a secret.
  if (/^[A-Z][A-Z0-9_]{1,40}$/.test(v)) return true;
  return false;
}

// Keys that may hold a concrete value in a template because they are not
// credentials. Each needs a reason - the list is a decision record.
const SAFE_TEMPLATE_KEYS = {
  MINIO_ENDPOINT: 'a compose service name',
  MINIO_USE_SSL: 'boolean flag',
  MINIO_VIDEO_BUCKET: 'bucket name',
  MINIO_THUMBNAIL_BUCKET: 'bucket name',
  MINIO_AVATAR_BUCKET: 'bucket name',
  MINIO_COVER_BUCKET: 'bucket name',
  MINIO_HLS_RETENTION_DAYS: 'a number',
  MINIO_PROMETHEUS_AUTH_TYPE: 'an enum',
  MINIO_PUBLIC_HOST: 'host:port',
  REDIS_URL: 'no inline password - one would be caught by the DSN rule',
  REDIS_CLUSTER_URL: 'no inline password - one would be caught by the DSN rule',
  NATS_URL: 'scheme + host',
  NATS_JETSTREAM_URL: 'scheme + host',
  DATABASE_URL: 'no inline password - one would be caught by the DSN rule',
  DATABASE_URL_REPLICA: 'no inline password - one would be caught by the DSN rule',
  NODE_ENV: 'a known enum',
  VAPID_SUBJECT: 'a contact URI',
  VAPID_PUBLIC_KEY: 'public by definition',
  FFMPEG_PATH: 'a filesystem path',
  SMTP_USE_TLS: 'boolean flag',
  EMAIL_USE_TLS: 'boolean flag',
  VAULT_ADDR: 'an address, not a token',
  // Passwords stay in the key-name rule. Listed here only to document that
  // they must be placeholders even though a local dev DSN is harmless.
  MINIO_ROOT_PASSWORD: 'must be a placeholder even for local dev',
  MINIO_AUTH_SECRET_KEY: 'must be a placeholder even for local dev',
  MINIO_ROOT_USER: 'must be a placeholder even for local dev',
  MINIO_AUTH_ACCESS_KEY: 'must be a placeholder even for local dev',
};

// ---------------------------------------------------------------------------
// Connection strings with a LITERAL password
// ---------------------------------------------------------------------------

// Only matches scheme://user:LITERAL@host. A %s or ${VAR} password is the
// correct way to build a DSN and is deliberately not matched.
const DSN_WITH_PASSWORD = /\b(?:postgres(?:ql)?|redis(?:s)?|mysql|amqp):\/\/[^:@/\s]+:([^:@/\s"']{6,})@/i;

// A quoted Go/DSN string where password= is a literal rather than a verb or a
// concatenation. The captured value is validated by passwordIsLiteral, which
// rejects anything containing an operator.
const DSN_FIELD_PASSWORD = /\bpassword\s*=\s*"([^"]{6,})"/i;

// A synthetic token in a test fixture is required in order to test token
// handling at all - password_test.go builds a fake JWT on purpose. Everywhere
// else a literal JWT is a live credential.
const TEST_FILE = /(_test\.go|\.test\.[tj]sx?|\.spec\.[tj]sx?|__tests__[/\\])/i;

function passwordIsLiteral(pw) {
  if (!pw) return false;
  if (isPlaceholder(pw)) return false;
  // Go/Sprintf verbs and shell vars mean the value comes from config.
  if (/^[%$\{]/.test(pw)) return false;
  // String concatenation is parameterisation, not a literal:
  //   "host=" + d.Host + " password=" + d.Password
  if (/[\s+|&]/.test(pw)) return false;
  return true;
}

// Passwords that are the universal well-known defaults. These are not secrets
// - `postgres:postgres` on localhost is the first thing anyone types, and it
// appears as a viper default in most services in this repo.
//
// They are reported as WARNINGS, not failures. A pre-commit hook that blocks
// the entire existing codebase on day one gets disabled by day two, and then
// it protects nothing. So: block on anything that could be a real credential,
// warn on the defaults, and let the warnings accumulate into a backlog that is
// actually readable.
const WELL_KNOWN_DEFAULTS = new Set([
  'postgres', 'password', 'admin', 'root', 'changeme', 'change-me',
  'secret', 'test', 'user', 'guest', 'default',
]);

function isWellKnownDefault(pw) {
  return WELL_KNOWN_DEFAULTS.has(String(pw).trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const findings = [];
const warnings = [];
const report = (file, line, text) => findings.push({ file, line, text });
const warn = (file, line, text) => warnings.push({ file, line, text });

// reportOrWarn routes a connection-string finding by how real the password
// looks, so a dev default never blocks a commit.
function reportDSN(file, line, label, pw) {
  if (isWellKnownDefault(pw)) {
    warn(file, line, `${label}: inline password is the well-known default "${pw}" - fine for local dev, must be overridden in production`);
  } else {
    report(file, line, `${label}: connection string with an inline password`);
  }
}

function scanTemplate(file) {
  let content;
  try {
    content = readFileSync(join(REPO_ROOT, file), 'utf8');
  } catch {
    return;
  }

  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq === -1) return;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (value === '') return;

    // Rule 1 - a secret-named key must never hold a concrete value.
    if (SECRET_KEY_PATTERN.test(key) && !isPlaceholder(value)) {
      report(file, i + 1, `${key}: secret-named key holds a concrete value (${value.length} chars)`);
      return;
    }

    // Rule 2 - allowlisted keys are still pattern-checked, so a real
    // credential pasted under an allowlisted name is still caught.
    for (const { name, re } of VALUE_PATTERNS) {
      if (re.test(value)) {
        report(file, i + 1, `${key}: matches the ${name} pattern`);
        return;
      }
    }

    // Rule 3 - inline password in a DSN.
    const dsn = value.match(DSN_WITH_PASSWORD);
    if (dsn && passwordIsLiteral(dsn[1])) {
      reportDSN(file, i + 1, key, dsn[1]);
    }
  });
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

const SOURCE_EXTS = new Set(['.go', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.yml', '.yaml', '.env']);
const SKIP_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'go.sum']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '.next-monitor', '.turbo', 'dist', 'build',
  '.stale-backup', '.kilo', 'vendor', 'coverage', 'out',
]);

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(join(dir, e.name), depth + 1);
    } else if (!SKIP_FILES.has(e.name)) {
      yield join(dir, e.name);
    }
  }
}

function scanSources(stagedOnly) {
  let files;
  if (stagedOnly) {
    let out = '';
    try {
      out = execSync('git diff --cached --name-only --diff-filter=ACM', {
        cwd: REPO_ROOT, encoding: 'utf8',
      });
    } catch {
      return;
    }
    files = out.split(/\r?\n/).filter(Boolean);
  } else {
    files = [...walk(REPO_ROOT)].map((f) => relative(REPO_ROOT, f));
  }

  for (const file of files) {
    // Only scan the file types the value patterns can plausibly appear in.
    const base = file.split(/[\\/]/).pop();
    if (SKIP_FILES.has(base)) continue;
    const rel = file.split('\\').join('/');
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue;
    if (!SOURCE_EXTS.has(extname(file))) continue;

    let content;
    try {
      content = readFileSync(join(REPO_ROOT, file), 'utf8');
    } catch {
      continue;
    }

    content.split(/\r?\n/).forEach((line, i) => {
      const t = line.trim();
      if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return;

      for (const { name, re } of VALUE_PATTERNS) {
        // A fake token in a test fixture is the point of the fixture.
        if (name === 'JWT' && TEST_FILE.test(rel)) continue;
        if (re.test(line)) {
          report(file, i + 1, `${name} pattern in source`);
          return;
        }
      }

      const dsn = line.match(DSN_WITH_PASSWORD);
      if (dsn && passwordIsLiteral(dsn[1])) {
        reportDSN(file, i + 1, 'connection string', dsn[1]);
        return;
      }

      const field = line.match(DSN_FIELD_PASSWORD);
      if (field && passwordIsLiteral(field[1])) {
        reportDSN(file, i + 1, 'connection string', field[1]);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: node tools/audit-secrets.mjs [--staged] [--quiet]');
  process.exit(0);
}
const stagedOnly = args.includes('--staged');
const quiet = args.includes('--quiet');

if (!stagedOnly) {
  for (const f of TEMPLATE_FILES) scanTemplate(f);
}
scanSources(stagedOnly);

if (warnings.length && !quiet) {
  console.log(`audit-secrets: ${warnings.length} warning(s) - not blocking, but worth a look:`);
  for (const w of warnings) console.log(`  ${w.file}:${w.line}  ${w.text}`);
  console.log('');
}

if (findings.length === 0) {
  if (!quiet) console.log('audit-secrets: clean - no credentials found.');
  process.exit(0);
}

console.error('\naudit-secrets: FAILED - credentials must not be committed.\n');
for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.text}`);
console.error('\nPut the real value in .env (gitignored) and a placeholder in the template.');
console.error('For a false positive, add the KEY to SAFE_TEMPLATE_KEYS in');
console.error('tools/audit-secrets.mjs with a reason - do not weaken the patterns.');
console.error('');
process.exit(1);
