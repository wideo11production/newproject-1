#!/usr/bin/env node
// ============================================================================
// check-branding-wiring.mjs
// ============================================================================
// Pins the two Branding Phase B blockers (B-blocker-1 and B-blocker-2)
// in the CLOSED state they were fixed into.
//
// -----------------------------------------------------------------------------
// THE TWO BLOCKERS, AND WHAT CLOSED THEM
// -----------------------------------------------------------------------------
//
// B-blocker-1 — "branding source never registered in the compositor
//   sources map". `paintBranding` does `sources.get(clip.mediaId)` and
//   bails when the map has no entry, so a channel logo (whose id is
//   never a media-bin item) drew nothing in preview OR export.
//   CLOSED by `lib/engine/sources.ts`: `buildCompositorSources` now
//   takes the TRACKS as well as the media items and registers every
//   branding clip's own URL under its `mediaId`.
//
// B-blocker-2 — "`/api/channels` 404s from the editor". The branding
//   panel fetches same-origin `/api/channels`; those routes lived only
//   in `apps/web`, so the panel rendered "No channels found" for every
//   user on every project.
//   CLOSED by the editor's own BFF routes (`src/app/api/channels/…`)
//   relaying to auth-service through `lib/engine/channels-relay.ts`
//   (session cookie → bearer, literal upstream paths, UUID-validated
//   id — no open proxy).
//
// -----------------------------------------------------------------------------
// WHY A CHECK AND NOT A TEST
// -----------------------------------------------------------------------------
//
// These are wiring properties of a Next.js app: which files exist,
// which function signature a shared builder has, which URL a panel
// fetches. The repo's discipline for exactly this shape is a
// `tools/check-*.mjs` gate (see check-video-editor.mjs,
// check-dashboard.mjs), promoted to CI alongside the Go wiring
// tests. A regression here is silent — the panel shows an honest
// "No channels found" and nobody notices the logo is gone.
//
// USAGE
//
//   node tools/check-branding-wiring.mjs            # verify
//   node tools/check-branding-wiring.mjs --quiet    # exit code only
//
// EXIT: 0 all wired · 1 a blocker regressed
// ============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repo, rel), 'utf8');

const failures = [];
const check = (name, ok, detail) => {
  if (ok) return;
  failures.push({ name, detail });
};

// -----------------------------------------------------------------------------
// B-blocker-1: the compositor registration map covers branding clips
// -----------------------------------------------------------------------------

const sources = read('apps/video-editor/src/app/lib/engine/sources.ts');

// The builder must take BOTH inputs. Items alone cannot cover a
// channel logo: a channel is not a file the user imported.
check(
  'buildCompositorSources takes the tracks, not only the media items',
  /export function buildCompositorSources\(\s*items: MediaItem\[\],\s*tracks: TimelineTrack\[\]/.test(sources),
  'apps/video-editor/src/app/lib/engine/sources.ts must accept (items, tracks).',
);

// …and it must register the branding clip's own URL under its
// mediaId — the exact key paintBranding reads.
check(
  'branding clip URLs are registered under clip.mediaId',
  /track\.type !== 'branding'/.test(sources)
    && /clip\.url && !map\.has\(clip\.mediaId\)/.test(sources)
    && /map\.set\(clip\.mediaId, \{ url: clip\.url, kind: 'image' \}\)/.test(sources),
  'the branding-track loop must map.set(clip.mediaId, { url: clip.url, kind: "image" }).',
);

// Both callers — preview AND export — must pass the tracks through.
// Two builders, or one caller forgetting the tracks, is how preview
// and export disagree about which clips resolve.
const editor = read('apps/video-editor/src/app/components/video-editor.tsx');
const preview = read('apps/video-editor/src/app/components/preview/preview-canvas.tsx');

for (const [label, src] of [
  ['video-editor.tsx (export)', editor],
  ['preview-canvas.tsx (preview)', preview],
]) {
  check(
    `${label} builds sources from items AND tracks`,
    /buildCompositorSources\(media\.items, tracks\)/.test(src),
    `${label} must call buildCompositorSources(media.items, tracks) — passing only items reintroduces B-blocker-1.`,
  );
}

// -----------------------------------------------------------------------------
// B-blocker-2: the editor owns the /api/channels BFF routes
// -----------------------------------------------------------------------------

const routes = [
  'apps/video-editor/src/app/api/channels/route.ts',
  'apps/video-editor/src/app/api/channels/[id]/setup/route.ts',
];
for (const rel of routes) {
  check(
    `editor BFF route exists: ${rel}`,
    existsSync(join(repo, rel)),
    'the branding panel fetches same-origin /api/channels — without this route it 404s and the panel stays empty.',
  );
}

const listRoute = read(routes[0]);
check(
  'GET /api/channels delegates to the relay',
  /relayChannelList\(\)/.test(listRoute),
  'apps/video-editor/src/app/api/channels/route.ts must call relayChannelList().',
);

const setupRoute = read(routes[1]);
check(
  'GET/PATCH /api/channels/[id]/setup delegate to the relay',
  /relayChannelSetup\(id, 'GET'\)/.test(setupRoute)
    && /relayChannelSetup\(id, 'PATCH', request\)/.test(setupRoute),
  'the setup route must relay both GET and PATCH through relayChannelSetup(id, …).',
);

// -----------------------------------------------------------------------------
// The relay itself: session → bearer, literal paths, UUID-validated id
// -----------------------------------------------------------------------------

const relay = read('apps/video-editor/src/app/lib/engine/channels-relay.ts');

check(
  'relay sends the session cookie as a bearer to auth-service',
  /Authorization: `Bearer \$\{session\}`/.test(relay)
    && /cookies\(\)\.get\(SESSION_COOKIE\)/.test(relay),
  'the relay must read the wideo11_session cookie and forward it as a bearer token.',
);

// The upstream path must be a literal. A relay that interpolates a
// caller-supplied path is an open proxy into the internal network.
check(
  'relay upstream paths are literals, never request input',
  /callUpstream\('\/api\/v1\/auth\/channels', \{ method: 'GET' \}\)/.test(relay)
    && /callUpstream\(`\/api\/v1\/auth\/channels\/\$\{id\}\/setup`/.test(relay),
  'every upstream path must be built from literals + the UUID-validated id.',
);

check(
  'relay validates the channel id as a UUID before interpolating it',
  /const UUID = \/\^\[0-9a-f\]/.test(relay) && /if \(!UUID\.test\(id\)\)/.test(relay),
  'the id must be UUID-validated before it reaches a URL — a path separator in it would be a proxy.',
);

// And the panel must keep fetching same-origin. An absolute URL to
// the web app would be a cross-origin credentialed fetch the browser
// blocks, and the silent fallback is the empty panel again.
const panel = read('apps/video-editor/src/app/components/panels/branding-panel.tsx');
check(
  'branding panel fetches same-origin /api/channels',
  /fetch\('\/api\/channels', \{ cache: 'no-store' \}\)/.test(panel)
    && !/https?:\/\/(localhost|127\.0\.0\.1):3000\/api\/channels/.test(panel),
  'branding-panel.tsx must fetch the relative /api/channels, not an absolute web-app URL.',
);

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

if (failures.length === 0) {
  if (!process.argv.includes('--quiet')) {
    console.log('check-branding: both Phase B blockers stay CLOSED.');
    console.log('  B1 compositor sources map covers branding clip URLs (sources.ts).');
    console.log('  B2 /api/channels + /api/channels/:id/setup relay from the editor.');
  }
  process.exit(0);
}

console.error('check-branding: FAILED — a branding blocker has regressed.\n');
for (const f of failures) {
  console.error(`  ✗ ${f.name}`);
  console.error(`    ${f.detail}`);
}
console.error('');
process.exit(1);
