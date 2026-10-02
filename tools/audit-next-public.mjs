// Audit: which NEXT_PUBLIC_* vars does each app actually READ in browser code,
// and what value would compose be wiring in?
//
// WHY THIS NEEDS TO BE A SCRIPT
// ---------------------------
// `NEXT_PUBLIC_*` is inlined at BUILD time, so compose's runtime `environment:`
// block cannot change it. That means the value we pass as a build ARG becomes
// the value the browser sees forever.
//
// And compose already contains browser vars pointing at DOCKER-INTERNAL
// hostnames. `dashboard-service:8080` resolves inside the compose network and
// nowhere else, so a browser asked to call it fails every request. Those values
// are harmless today precisely because they are dead in the browser - the apps
// are running on their code fallbacks instead. Wiring them in as build args
// would swap a silent, working fallback for a silent, broken URL, which is
// strictly worse.
//
// So before adding any ARG, find out:
//   1. which vars each app actually reads, and where
//   2. whether the compose value is browser-reachable
//
// Anything that is NOT browser-reachable must not be promoted to a build arg.
//
// Usage:  node tools/audit-next-public.mjs
import fs from 'node:fs';
import path from 'path';

const ROOT = process.cwd();

/** Compose services that are browser apps. */
const APPS = [
  { service: 'web', dir: 'apps/web' },
  { service: 'video-editor', dir: 'apps/video-editor' },
  { service: 'admin', dir: 'apps/admin' },
  { service: 'analytics', dir: 'apps/analytics' },
  { service: 'billing', dir: 'apps/billing' },
  { service: 'monitor', dir: 'apps/monitor' },
  { service: 'superadmin-app', dir: 'apps/superadmin' },
];

// hostnames that exist ONLY inside the compose network
const INTERNAL = [
  'auth-service', 'dashboard-service', 'billing-service', 'currency-service',
  'transcoding-service', 'webhook-receiver', 'postgres', 'redis', 'nats',
  'minio', 'mail',
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Parse the `environment:` block that belongs to ONE compose service. */
function composeEnv(service) {
  const lines = fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l === `  ${service}:`);
  if (start < 0) return null;

  const env = {};
  let inEnv = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^  [a-z]/.test(l)) break; // next service
    if (/^    environment:\s*$/.test(l)) { inEnv = true; continue; }
    if (inEnv && /^    [a-z]/.test(l)) break; // next top-level key of this service
    const m = l.match(/^      ([A-Z_0-9]+):\s*(.*)$/);
    if (inEnv && m) env[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return env;
}

let anyUnsafe = false;

for (const { service, dir } of APPS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) { console.log(`\n### ${service} — MISSING (${dir})`); continue; }

  const env = composeEnv(service) ?? {};
  const files = walk(abs);

  const used = new Map(); // var -> [file:line]
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8').split('\n');
    src.forEach((line, i) => {
      // `process.env.X` and `process.env['X']`
      for (const m of line.matchAll(/process\.env\.([A-Z_0-9]+)|process\.env\[['"]([A-Z_0-9]+)['"]\]/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('NEXT_PUBLIC_')) continue;
        if (!used.has(name)) used.set(name, []);
        used.get(name).push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}`);
      }
    });
  }

  console.log(`\n### ${service}`);
  if (used.size === 0) console.log('  reads no NEXT_PUBLIC_* in browser code');

  for (const [name, where] of [...used].sort()) {
    const val = env[name] ?? '(not in compose environment)';
    const isInternal = INTERNAL.some((h) => val.includes(`//${h}:`) || val.includes(`//${h}/`));
    const inRuntimeOnly = val === '(not in compose environment)';
    // Is this a build-time-only var? Then a missing ARG is a hard failure.
    const flag = isInternal ? 'UNSAFE for browser' : inRuntimeOnly ? 'no runtime value' : 'ok';
    if (isInternal) anyUnsafe = true;
    console.log(`  ${name}`);
    console.log(`      compose value : ${val}`);
    console.log(`      read at       : ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` (+${where.length - 3})` : ''}`);
    console.log(`      verdict       : ${flag}`);
  }
}

console.log(
  `\n\n${anyUnsafe
    ? 'UNSAFE values present. Do NOT promote these to build args - a browser cannot resolve a compose hostname.'
    : 'No compose-internal hostnames in NEXT_PUBLIC_* vars.'}`
);