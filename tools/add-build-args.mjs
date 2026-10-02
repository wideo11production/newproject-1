// Add `args:` to each browser app's compose `build:` block, so the Dockerfile
// `ARG` declarations actually receive values.
//
// Why build args: `NEXT_PUBLIC_*` is inlined by `next build`, so a runtime
// `environment:` block cannot reach the browser. `args:` is what `ARG` consumes.
//
// Every value here is host-reachable (`localhost`). A compose-internal hostname
// would replace a working fallback with an unresolvable URL in the browser, so
// those are excluded by design - see `tools/audit-next-public.mjs`.
import fs from 'node:fs';

const P = 'docker-compose.yml';
const text = fs.readFileSync(P, 'utf8');

const ARGS = {
  web: [
    'NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_WEB:-web}',
    'NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL:-http://localhost:3000}',
    'NEXT_PUBLIC_AUTH_API: ${NEXT_PUBLIC_AUTH_API:-http://localhost:8085}',
    'NEXT_PUBLIC_MINIO_PUBLIC_HOST: ${NEXT_PUBLIC_MINIO_PUBLIC_HOST:-http://localhost:9000}',
    'NEXT_PUBLIC_MINIO_VIDEO_BUCKET: ${NEXT_PUBLIC_MINIO_VIDEO_BUCKET:-video}',
    'NEXT_PUBLIC_VIDEO_EDITOR_URL: ${NEXT_PUBLIC_VIDEO_EDITOR_URL:-http://localhost:3002}',
  ],
  'video-editor': ['NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_EDITOR:-editor}'],
  admin: [
    'NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_ADMIN:-admin}',
    'NEXT_PUBLIC_APP_URL: ${NEXT_PUBLIC_APP_URL_ADMIN:-http://localhost:3004}',
  ],
  analytics: ['NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_ANALYTICS:-analytics}'],
  billing: ['NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_BILLING:-billing}'],
  monitor: ['NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_MONITOR:-monitor}'],
  'superadmin-app': [
    'NEXT_PUBLIC_APP_SURFACE: ${NEXT_PUBLIC_APP_SURFACE_SUPERADMIN:-superadmin}',
  ],
};

const DOCKERFILE = {
  web: 'apps/web/Dockerfile',
  'video-editor': 'apps/video-editor/Dockerfile',
  admin: 'apps/admin/Dockerfile',
  analytics: 'apps/analytics/Dockerfile',
  billing: 'apps/billing/Dockerfile',
  monitor: 'apps/monitor/Dockerfile',
  'superadmin-app': 'apps/superadmin/Dockerfile',
};

const lines = text.split('\n');
const out = [];
let service = null;
let changed = 0;
const missed = [];

for (const line of lines) {
  const svc = line.match(/^  ([a-z][a-z0-9-]*):\s*$/);
  if (svc) service = svc[1];
  out.push(line);

  const args = ARGS[service];
  if (!args) continue;
  if (!/^      dockerfile:/.test(line)) continue;
  if (!line.includes(DOCKERFILE[service])) continue;

  out.push('      args:');
  for (const a of args) out.push(`        ${a}`);
  out.push('        # `NEXT_PUBLIC_*` `next build` me INLINE hota hai, isliye');
  out.push('        # runtime `environment:` se nahi, yahan se jaana padta hai.');
  out.push('        # Inme koi compose-internal hostname nahi: browser unhe');
  out.push('        # resolve nahi kar sakta, to wahan kaam karta fallback');
  out.push('        # badal kar chup-chaap toota URL mil jayega.');
  changed++;
}

for (const s of Object.keys(ARGS)) {
  if (!out.some((l) => l.includes(`${s}:`) && lines.length)) continue;
}
fs.writeFileSync(P, out.join('\n'));

console.log(`services given build args: ${changed}/${Object.keys(ARGS).length}`);
if (changed !== Object.keys(ARGS).length) {
  console.log('Not all services were matched - check the dockerfile: anchors above.');
}