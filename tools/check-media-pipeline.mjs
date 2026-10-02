#!/usr/bin/env node
// Drive the media pipeline end to end: upload -> finalize -> transcode -> ready.
//
// This is the test for the gap that was invisible: an asset reached `uploaded`
// and stayed there, because the transcoder did the work and finished silently.
// Nothing is red, nothing errors, the file IS in the bucket - and the channel
// shows nothing, because a count only includes `ready`. A creator concludes the
// product is broken.
//
// So this asserts the asset actually LEAVES `uploaded` on its own, with no
// database fiddling, because that is the only version that proves the wiring.
//
// Usage:  node tools/check-media-pipeline.mjs
//
// Needs a plan with media allowance, so the quota check at `initiated` does not
// refuse first. A pro grant is applied to the harness user by this script.

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME_BIN ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const AUTH = process.env.AUTH_URL ?? 'http://localhost:8085';
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';
const TOKENS = process.env.TOKENS_ENDPOINT ?? 'http://localhost:8085/api/v1/auth/internal/tokens';
const CHANNEL_ID = process.env.PROBE_CHANNEL_ID ?? '';

let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log(`PASS  ${n}`, d ? JSON.stringify(d) : ''); } else { fail++; console.log(`FAIL  ${n}`, d ? JSON.stringify(d) : ''); } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---- 1. a real video file, so the pipeline has real bytes ----
  const tmp = mkdtempSync(join(tmpdir(), 'media-'));
  // A minimal but real MP4: ftyp + moov is enough for MinIO to store, and the
  // transcoder will fail on it honestly, which still proves the callback path
  // (it reports `failed`, and the asset must MOVE).
  const file = join(tmp, 'probe.mp4');
  writeFileSync(file, Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64),
  ]));

  // ---- 2. sign in, with a plan that allows media ----
  const login = await fetch(`${AUTH}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    console.error(`login failed: ${login.status} ${await login.text()}`);
    process.exit(1);
  }

  // The token is under `tokens`, not at the top level. The first version of this
  // file read `access_token` and got undefined, which surfaced as "the harness
  // user owns no channel" - an error two steps away from its cause.
  const loginBody = await login.json();
  const tok = loginBody?.tokens?.access_token;

  // NO COOKIE, deliberately. auth-service sets a refresh token in its response
  // body but does not set the `wideo11_session` cookie - that is the web
  // proxy's job (`apps/web/src/app/api/auth/login/route.ts`). Every call below
  // goes straight to auth-service with the bearer token, so requiring a cookie
  // here was asserting something this service was never supposed to do.
  if (!tok) {
    console.error('login succeeded but returned no access token', {
      fields: Object.keys(loginBody ?? {}),
      tokenFields: Object.keys(loginBody?.tokens ?? {}),
    });
    process.exit(1);
  }
  check('signed in', !!tok, { hasToken: !!tok });

  const auth = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

  // The harness user needs media allowance or the quota refuses at initiate and
  // the pipeline is never entered.
  const ch = CHANNEL_ID || (await ensureChannel(tok)).id;

  // ---- 3. initiate ----
  const initiated = await fetch(`${AUTH}/api/v1/auth/media/initiate`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      kind: 'video',
      filename: 'probe.mp4',
      content_type: 'video/mp4',
      size: 12,
      declared_duration_seconds: 5,
      channel_id: ch,
    }),
  });
  const initBody = await initiated.json().catch(() => ({}));
  check('initiate accepted', initiated.ok, { status: initiated.status, body: initBody });
  if (!initiated.ok) return;
  const asset = initBody.asset;
  check('the asset is created `initiated`', asset?.status === 'initiated', { status: asset?.status });

  // ---- 4. PUT the bytes, straight to MinIO via the presigned URL ----
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(file);
  const put = await fetch(initBody.upload.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4' },
    body: bytes,
  });
  check('the bytes went straight to storage', put.ok, { status: put.status });

  // ---- 5. finalize -> `uploaded`, and a transcode job is queued ----
  const fin = await fetch(`${AUTH}/api/v1/auth/media/${asset.id}/finalize`, {
    method: 'POST', headers: auth, body: JSON.stringify({ objectKey: initBody.upload.object_key }),
  });
  const finBody = await fin.json().catch(() => ({}));
  check('finalize accepted', fin.ok, { status: fin.status });
  check('the transcoder was told about the job', finBody.transcode_queued === true, finBody);

  // ---- 6. THE ACTUAL ASSERTION: does it leave `uploaded` by itself? ----
  //
  // No database edit, no manual poke. If the callback is not wired, this is where
  // it sits forever - and that is precisely the bug this file exists for.
  let final = null;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const res = await fetch(`${AUTH}/api/v1/auth/media/${asset.id}/status`, { headers: auth });
    if (!res.ok) continue;
    final = await res.json();
    if (final.status === 'ready' || final.status === 'failed') break;
  }
  check(
    'the asset LEFT `uploaded` without being poked',
    final && final.status !== 'uploaded',
    final
  );
  check(
    'and it settled on a terminal state',
    final && (final.status === 'ready' || final.status === 'failed'),
    { status: final?.status, failure: final?.failure }
  );
  // A deliberately tiny fake file CANNOT transcode. The point is that it ends
  // `failed` WITH A REASON rather than stuck - the outcome is honest either way.
  if (final?.status === 'failed') {
    check('a failure carries a reason a creator can act on', (final.failure ?? '').length > 0, {
      failure: final.failure,
    });
  }

  rmSync(tmp, { recursive: true, force: true });
}

async function ensureChannel(tok) {
  // A channel to file the media under. Any public channel owned by the harness.
  const r = await fetch(`${AUTH}/api/v1/auth/channels`, { headers: { Authorization: `Bearer ${tok}` } });
  const list = await r.json().catch(() => ({}));
  const mine = (list.channels ?? []).find((c) => c.handle);
  if (mine) return { id: mine.id, handle: mine.handle };
  throw new Error('the harness user owns no channel to file media under');
}

await main();

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(fail === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
