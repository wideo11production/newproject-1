// Triage the services that exist in `services/` but are not in compose.
//
// WHY THIS SCRIPT EXISTS
// ---------------------
// `services/` holds 34 directories and compose runs 4 of them. Between them the
// undeployed ones are ~20,000 lines of Go that compiles. Planning a phase that
// "builds the ads manager" without knowing an `ads-service` already exists is
// how you end up with two of everything.
//
// It answers four objective questions per service, so the adopt/port/delete
// decision rests on facts rather than on a directory listing:
//
//   1. does it build?            (a scaffold that does not compile is dead weight)
//   2. how big is it?            (lines, and how many HTTP routes - real surface?)
//   3. does it authenticate?     (this is the big one: several have NO auth at all)
//   4. whose database does it use? (a service pointing at auth_service's tables is
//                                  a design smell, not a service boundary)
//
// Usage:  node tools/triage-services.mjs
import fs from 'node:fs';
import path from 'path';
import { execFileSync, execSync } from 'node:child_process';

const ROOT = process.cwd();

const deployed = new Set(
  execSync('docker compose config --services', { encoding: 'utf8', shell: 'C:\\Program Files\\Git\\bin\\bash.exe' })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
);

/** A directory is deployed if compose knows it, under any of these names. */
const nameMatches = (dir, svc) =>
  svc === dir || svc === `${dir}-service` || svc === `${dir}-app` || svc === dir.replace(/-service$/, '');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.go')) out.push(p);
  }
  return out;
}

const rows = [];

for (const dir of fs.readdirSync(path.join(ROOT, 'services')).sort()) {
  const abs = path.join(ROOT, 'services', dir);
  if (!fs.statSync(abs).isDirectory()) continue;

  const goFiles = walk(abs);
  let lines = 0;
  let routes = 0;
  let hasAuth = false;
  const dbs = new Set();

  for (const f of goFiles) {
    const src = fs.readFileSync(f, 'utf8');
    lines += src.split('\n').length;

    // Route registrations, in any of the shapes these services use.
    const r = src.match(/\b(GET|POST|PUT|DELETE|PATCH)\(\s*"?[:.*'"]/g);
    if (r) routes += r.length;

    // Auth. Deliberately broad - any of these counts, because the question is
    // "is there ANY gate", and the answer being "no" is the finding.
    if (/\bUse\(.*(Auth|auth|JWT|jwt|APIKey|apiKey|Bearer)\w*\)/.test(src)) hasAuth = true;
    if (/func\s+\w*(Auth|auth|JWT|jwt)\w*Middleware/.test(src)) hasAuth = true;
    if (/Authorization.*Bearer/i.test(src)) hasAuth = true;

    for (const m of src.matchAll(/(?:database|dbname|DBName|database)\s*[:=]\s*"?([a-z][a-z0-9_-]{3,})"?/gi)) {
      if (!['postgres', 'null', 'string', 'bool', 'int', 'error', 'time'].includes(m[1].toLowerCase())) {
        dbs.add(m[1].toLowerCase());
      }
    }
  }

  let builds = 'n/a';
  if (goFiles.some((f) => f.includes(`${path.sep}cmd${path.sep}`))) {
    try {
      execFileSync('go', ['build', './...'], { cwd: abs, stdio: 'pipe', timeout: 180000 });
      builds = 'yes';
    } catch {
      builds = 'NO';
    }
  }

  const isDeployed = [...deployed].some((s) => nameMatches(dir, s));

  rows.push({ dir, deployed: isDeployed, lines, routes, hasAuth, builds, dbs: [...dbs].slice(0, 3) });
}

const unused = rows.filter((r) => !r.deployed).sort((a, b) => b.lines - a.lines);

console.log(`services on disk: ${rows.length}   in compose: ${rows.filter((r) => r.deployed).length}   undeployed: ${unused.length}\n`);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('service', 24) + pad('builds', 7) + pad('lines', 7) + pad('routes', 8) + pad('auth', 6) + 'flags');
console.log('-'.repeat(84));
for (const r of unused) {
  const flags = [];
  if (!r.hasAuth) flags.push('NO AUTH');
  if (r.builds === 'NO') flags.push('does not compile');
  if (r.routes === 0 && r.lines > 0) flags.push('no HTTP surface');
  console.log(
    pad(r.dir, 24) + pad(r.builds, 7) + pad(r.lines, 7) + pad(r.routes, 8) + pad(r.hasAuth ? 'yes' : 'NO', 6) + flags.join(', ')
  );
}

const noAuth = unused.filter((r) => r.lines > 0 && !r.hasAuth);
console.log(`\nundeployed, non-empty, with NO auth: ${noAuth.length} (${noAuth.reduce((a, r) => a + r.lines, 0)} lines)`);
const broken = unused.filter((r) => r.builds === 'NO');
console.log(`undeployed and not compiling:        ${broken.length}${broken.length ? ' -> ' + broken.map((r) => r.dir).join(', ') : ''}`);