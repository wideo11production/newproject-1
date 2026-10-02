#!/usr/bin/env node
// Fix the viper env-key bug across every service in `services/`.
//
// =============================================================================
// THE BUG
// =============================================================================
//
// Viper maps a config key to an environment variable by upper-casing it and
// replacing the SEPARATOR - but only if you tell it what the separator is via
// `SetEnvKeyReplacer`. Without that call it looks for the key verbatim, upper-cased,
// dots and all:
//
//     key  security.internal_token
//     wants  SECURITY.INTERNAL_TOKEN      <- with a dot
//     compose sets  SECURITY_INTERNAL_TOKEN   <- underscore
//
// Nothing errors. Nothing warns. The process boots, every value arrives as its
// zero value, and a security setting that was configured reads as disabled.
//
// It is not theoretical. `analytics-service` was about to start with NO
// authentication because of it, and the only reason that was caught was a
// fail-closed startup check refusing to run. `device_limit.enabled` in
// `auth-service` had the same defect, silently disabling the per-device account
// cap.
//
// 25 of the 28 services using viper have it. That is the most likely reason
// none of them were ever deployed: setting an env var on them does nothing, so
// they could never be configured into working.
//
// =============================================================================
// WHY A SCRIPT AND NOT 25 MANUAL EDITS
// =============================================================================
//
// Because 25 identical manual edits is 25 chances to introduce a typo into a file
// that only fails when the service is deployed, which is exactly when nobody is
// looking. So this script patches, then VERIFIES EVERY SERVICE COMPILES. A
// service that stops building is reported loudly rather than quietly left broken.
//
// Idempotent: a file that already has the replacer is skipped.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();

const REPLACER_LINE = '\tviper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))\n';

const NOTE = [
  '',
  '\t// ---- ENVIRONMENT VARIABLES NEED THIS LINE TO WORK AT ALL ----',
  '\t//',
  '\t// Viper looks up an env var by upper-casing the key and replacing the',
  '\t// SEPARATOR - but only when `SetEnvKeyReplacer` says what the separator is.',
  '\t// Without it, `security.internal_token` is looked up as',
  '\t// `SECURITY.INTERNAL_TOKEN`, with a literal dot, which nothing sets.',
  '\t//',
  '\t// The result is silent: no error, no warning, the process starts, and every',
  '\t// value arrives as its zero value. A security setting that was configured',
  '\t// reads as DISABLED.',
  '\t//',
  '\t// This is not theoretical. `analytics-service` was about to start with no',
  '\t// authentication because of it, and the only reason that was caught was a',
  '\t// fail-closed startup check refusing to run. 25 of the 28 viper services in',
  '\t// this tree had the same defect - see SERVICE-TRIAGE.md.',
  '',
].join('\n');

/** Recursively find .go files, skipping vendor-ish directories. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'config.go') out.push(p);
  }
  return out;
}

const servicesDir = path.join(ROOT, 'services');
const patched = [];
const skipped = [];
const failed = [];

for (const svcName of fs.readdirSync(servicesDir).sort()) {
  const svcDir = path.join(servicesDir, svcName);
  if (!fs.statSync(svcDir).isDirectory()) continue;

  const candidates = walk(svcDir).filter((p) => {
    const src = fs.readFileSync(p, 'utf8');
    return src.includes('AutomaticEnv') && !src.includes('SetEnvKeyReplacer');
  });

  if (candidates.length === 0) {
    skipped.push(`${svcName} (no config.go using AutomaticEnv without a replacer, or already fixed)`);
    continue;
  }

  for (const file of candidates) {
    let src = fs.readFileSync(file, 'utf8');

    // 1. Insert the replacer immediately after the AutomaticEnv() call, with
    //    the comment above it. Adjacent placement is deliberate: this is a
    //    config-loading detail, and finding it next to the AutomaticEnv it
    //    belongs to is how a future reader understands the dependency.
    const anchor = src.match(/^([ \t]*)viper\.AutomaticEnv\(\)[ \t]*$/m);
    if (!anchor) {
      failed.push(`${svcName}: could not locate an AutomaticEnv() line to anchor to`);
      continue;
    }
    const at = src.indexOf(anchor[0]) + anchor[0].length;
    src = src.slice(0, at) + NOTE + REPLACER_LINE + src.slice(at);

    // 2. Add the `strings` import if it is not already there.
    if (!/^\s*"strings"\s*$/m.test(src)) {
      const imp = src.match(/^import \(\r?\n/m);
      if (!imp) {
        failed.push(`${svcName}: no import block found`);
        continue;
      }
      const pos = src.indexOf(imp[0]) + imp[0].length;
      src = src.slice(0, pos) + '\t"strings"\n' + src.slice(pos);
    }

    fs.writeFileSync(file, src);
    patched.push({ svc: svcName, file: path.relative(ROOT, file).replace(/\\/g, '/') });
  }
}

// ---- gofmt, then PROVE every touched service still compiles ----------------
//
// The build check is the point of this script. A regex edit that breaks an
// import would otherwise sit unnoticed until deployment.
console.log(`patched ${patched.length} config file(s)\n`);

for (const { svc, file } of patched) {
  const svcDir = path.join(servicesDir, svc);

  // gofmt first: it sorts the import group the `strings` line was added to.
  try {
    execFileSync('gofmt', ['-w', file], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    failed.push(`${svc}: gofmt failed - ${String(e.message).split('\n')[0]}`);
    continue;
  }

  if (!fs.existsSync(path.join(svcDir, 'go.mod'))) {
    skipped.push(`${svc} (patched ${file}, no go.mod so no build check)`);
    continue;
  }

  try {
    execFileSync('go', ['build', './...'], { cwd: svcDir, stdio: 'pipe', timeout: 240000 });
    console.log(`  OK    ${svc}`);
  } catch (e) {
    const msg = String(e.stderr || e.message || '').split('\n').filter(Boolean).slice(0, 3).join(' ');
    failed.push(`${svc}: BUILD FAILED after patch - ${msg}`);
    console.log(`  FAIL  ${svc}`);
  }
}

if (skipped.length) {
  console.log('\nskipped:');
  for (const s of skipped) console.log(`  - ${s}`);
}
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\nall patched services compile.');