// Wire `NEXT_PUBLIC_*` as Docker BUILD ARGS for every browser app.
//
// WHY ARGS AND NOT THE RUNTIME `environment:` BLOCK
// -------------------------------------------------
// Next.js replaces `process.env.NEXT_PUBLIC_X` at BUILD time. In a standalone
// container the bundle is already compiled by the time the runtime env applies,
// so a runtime value cannot change it. Compose's `environment:` block is
// therefore decorative for these variables - setting `NEXT_PUBLIC_FOO` there
// does nothing to the browser.
//
// It went unnoticed because every read site has a correct hardcoded fallback,
// so the app behaves right either way. The cost is that the env var is a lie:
// setting it changes nothing, which is worse than not having it.
//
// The click ledger is what finally exposed it. The editor was labelling its
// events `port-3002` (a fallback) instead of `editor`.
//
// WHAT IS DELIBERATELY NOT WIRED
// -------------------------------
// Anything whose compose value is a compose-internal hostname. A browser cannot
// resolve `auth-service` or `dashboard-service`, so promoting those to a build
// arg would replace a working fallback with an unresolvable URL - a silent
// breakage instead of a silent correctness. `tools/audit-next-public.mjs`
// checks for this; run it after editing compose.
//
// This script ADDS to each Dockerfile's builder stage. It refuses to touch a
// Dockerfile that already declares an ARG for that name, so re-running is safe.
import fs from 'node:fs';
import path from 'path';

const ROOT = process.cwd();

const APPS = [
  { service: 'web', dockerfile: 'apps/web/Dockerfile' },
  { service: 'video-editor', dockerfile: 'apps/video-editor/Dockerfile' },
  { service: 'admin', dockerfile: 'apps/admin/Dockerfile' },
  { service: 'analytics', dockerfile: 'apps/analytics/Dockerfile' },
  { service: 'billing', dockerfile: 'apps/billing/Dockerfile' },
  { service: 'monitor', dockerfile: 'apps/monitor/Dockerfile' },
  { service: 'superadmin-app', dockerfile: 'apps/superadmin/Dockerfile' },
];

/**
 * Host-reachable defaults per app.
 *
 * These are `localhost` on purpose: every app runs on the host in this stack,
 * so `localhost` is the only value a browser can actually resolve. An app
 * deployed elsewhere overrides them in its own compose.
 *
 * Only variables that appear are emitted, so a Dockerfile never carries a
 * default for something it does not read.
 */
const VARS = {
  web: {
    NEXT_PUBLIC_APP_SURFACE: 'web',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_AUTH_API: 'http://localhost:8085',
    NEXT_PUBLIC_MINIO_PUBLIC_HOST: 'http://localhost:9000',
    NEXT_PUBLIC_MINIO_VIDEO_BUCKET: 'video',
    NEXT_PUBLIC_VIDEO_EDITOR_URL: 'http://localhost:3002',
  },
  'video-editor': { NEXT_PUBLIC_APP_SURFACE: 'editor' },
  // Port verified against `docker compose config`:
  //   web 3000, billing 3003, admin 3004, analytics 3005,
  //   monitor 3001, video-editor 3002, superadmin 3008
  admin: { NEXT_PUBLIC_APP_SURFACE: 'admin', NEXT_PUBLIC_APP_URL: 'http://localhost:3004' },
  analytics: { NEXT_PUBLIC_APP_SURFACE: 'analytics' },
  billing: { NEXT_PUBLIC_APP_SURFACE: 'billing' },
  currency: { NEXT_PUBLIC_APP_SURFACE: 'currency', NEXT_PUBLIC_CURRENCY_API: 'http://localhost:8086' },
  monitor: { NEXT_PUBLIC_APP_SURFACE: 'monitor' },
  'superadmin-app': { NEXT_PUBLIC_APP_SURFACE: 'superadmin' },
};

const BLOCK = (vars) => `
# ---- NEXT_PUBLIC_* ko BUILD TIME par pass karo ----
#
# Next.js inhe \`next build\` ke dauraan source me inline kar deta hai, runtime
# par nahi. Isliye compose ka \`environment:\` block in vars ke liye DEAD hai -
# bundle pehle hi compile ho chuka hota hai. Ye ARG block usi ko build time
# par wapas laata hai.
#
# Har app me har \`NEXT_PUBLIC_*\` read site par ek hardcoded fallback hai, aur wahi
# sahi value hai - isliye bug chup-chaap tha. Click ledger me hi nikla: editor
# apne events \`port-3002\` (fallback) label ke saath bhej raha tha, \`editor\`
# nahi.
#
# NOTE: sirf wahi vars yahan hain jo BROWSER me padhe jaate hain aur jinki value
# host se resolve ho sakti hai. Koi compose-internal hostname (\`auth-service\`,
# \`dashboard-service\`) jaan-boojh kar nahi daala gaya - browser unhe resolve hi
# nahi kar sakta, to ek kaam karne wala fallback badal kar chup-chaap toota URL
# mil jata.
${Object.entries(vars)
  .map(([k, v]) => `ARG ${k}=${v}\nENV ${k}=$${k}`)
  .join('\n')}
`;

let changed = 0;
const skipped = [];

for (const { service, dockerfile } of APPS) {
  const abs = path.join(ROOT, dockerfile);
  if (!fs.existsSync(abs)) { skipped.push(`${service}: no Dockerfile at ${dockerfile}`); continue; }

  const vars = VARS[service];
  if (!vars || Object.keys(vars).length === 0) { skipped.push(`${service}: no vars configured`); continue; }

  let text = fs.readFileSync(abs, 'utf8');

  // Already declared? Do not touch - re-running must be idempotent, and
  // silently rewriting someone's hand-tuned block would be worse than skipping.
  const already = Object.keys(vars).filter((k) => new RegExp(`^ARG ${k}=`, 'm').test(text));
  if (already.length === Object.keys(vars).length) {
    skipped.push(`${service}: already declares all ${already.length} ARG(s)`);
    continue;
  }

  // Insert immediately before the build step, which is the only place the
  // builder-stage env can still affect the compiled output.
  const buildStep = /^(RUN .*next(\/|\\)dist(\/|\\)bin(\/|\\)next build|RUN pnpm build|RUN npm run build|RUN yarn build)\s*$/m;
  const m = text.match(buildStep);
  if (!m) { skipped.push(`${service}: could not find a \`next build\` step - NOT MODIFIED`); continue; }

  const at = text.indexOf(m[0]);
  const before = text.slice(0, at);
  const after = text.slice(at);

  text = `${before}${BLOCK(vars)}${after}`;
  fs.writeFileSync(abs, text);
  changed++;
  console.log(`  ${service}: added ${Object.keys(vars).length} ARG(s) to ${dockerfile}`);
}

console.log(`\nDockerfiles changed: ${changed}/${APPS.length}`);
if (skipped.length) {
  console.log('\nSkipped (each one needs a look, not a blind edit):');
  for (const s of skipped) console.log(`  - ${s}`);
}