// Replace every app's copy-pasted audit route with a thin re-export of the
// shared handler in `@wideo11/ui`.
//
// Why: the handler existed as six real copies across seven apps and had already
// drifted into three variants. Five of them still carried a bug where an
// unreachable audit store was reported to the browser as `400 Bad Request`,
// which reads as a client bug when it is an infrastructure outage. One
// implementation fixes all of them and cannot drift again.
//
// The currency app gets the route for the first time - it was serving a real
// browser surface (rates, convert, refresh) with no tracker and no audit route,
// so none of its activity reached the ledger.
//
// Usage:  node tools/unify-audit-routes.mjs
import fs from 'node:fs';
import path from 'path';

const ROOT = process.cwd();

/** Every app that serves a browser surface and therefore mounts the tracker. */
const APPS = [
  { dir: 'apps/web', audit: 'src/app/api/audit/route.ts' },
  { dir: 'apps/video-editor', audit: 'src/app/api/audit/route.ts' },
  { dir: 'apps/admin', audit: 'src/app/api/audit/route.ts' },
  { dir: 'apps/analytics', audit: 'app/api/audit/route.ts' },
  { dir: 'apps/billing', audit: 'app/api/audit/route.ts' },
  { dir: 'apps/monitor', audit: 'src/app/api/audit/route.ts' },
  { dir: 'apps/superadmin', audit: 'src/app/api/audit/route.ts' },
  { dir: 'apps/currency', audit: 'src/app/api/audit/route.ts' },
];

const BODY = `// Click/activity capture endpoint.
//
// The implementation is SHARED: \`@wideo11/ui/audit-handler\`. This file used to
// be a copy-paste of the same ~90 lines in every app, and it had already drifted
// into three variants - five of which reported an unreachable audit store to the
// browser as \`400 Bad Request\`, which looks like a client bug when it is really
// the store being down.
//
// A fix in one copy left the other six silently wrong. Now there is one
// implementation and this route is only the wiring.
//
// See the handler's header comment for the full reasoning.

import { handleClickEvents } from '@wideo11/ui/audit-handler';

export async function POST(request: Request) {
  return handleClickEvents(request);
}
`;

let written = 0;
let problems = [];

for (const { dir, audit } of APPS) {
  const abs = path.join(ROOT, dir, audit);

  if (!fs.existsSync(abs)) {
    // New file - make the directory.
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, BODY);
    written++;
    console.log(`  ${dir}: CREATED (had no audit route)`);
    continue;
  }

  const before = fs.readFileSync(abs, 'utf8');
  if (before.includes('@wideo11/ui/audit-handler')) {
    console.log(`  ${dir}: already unified`);
    continue;
  }

  const beforeLines = before.split('\n').length;
  fs.writeFileSync(abs, BODY);
  written++;
  console.log(`  ${dir}: ${beforeLines} lines -> ${BODY.split('\n').length} lines`);
}

console.log(`\nroutes written: ${written}/${APPS.length}`);
if (problems.length) {
  console.log('\nNeeds a look:');
  for (const p of problems) console.log(`  - ${p}`);
}