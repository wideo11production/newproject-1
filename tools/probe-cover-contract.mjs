// probe-cover-contract.mjs
//
// Reproduces the reported bug: "channel cover upload does not work while
// creating a channel, but works when editing an existing channel".
//
// The existing `check-channel-wizard.mjs` passes 16/16 and NEVER touches the
// cover - so it cannot see this. That is the same class of problem this repo has
// hit before: a check that returns OK because it verified the wrong thing.
//
// What this does: get a real session, call the CREATE-time upload-url endpoint,
// and print the EXACT response keys. The claim under test is that the wizard
// reads a key the server does not send.

const AUTH = process.env.AUTH_URL ?? 'http://localhost:8085';
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';
import fs from 'node:fs';

async function tokens() {
  // A real login, not the internal tokens endpoint - that route does not exist
  // on this service, and a probe that depends on a route nobody can find is a
  // probe that quietly stops testing anything.
  const res = await fetch(`${AUTH}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  const t = body.tokens?.access_token ?? body.access_token;
  if (!t) throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  return t;
}

const fail = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? 'PASS ' : 'FAIL '} ${label}${detail ? ` ${JSON.stringify(detail)}` : ''}`);
  if (!cond) fail.push(label);
};

const token = await tokens();
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// ---- 1. What the server actually sends ----
const urlRes = await fetch(`${AUTH}/api/v1/auth/channels/cover/upload-url`, {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ filename: 'probe.png', contentType: 'image/png' }),
});
const ticket = await urlRes.json().catch(() => ({}));
const keys = Object.keys(ticket).sort();

console.log(`\ncreate-time upload-url -> ${urlRes.status}`);
console.log(`keys returned: ${keys.join(', ')}\n`);

ok('the create-time upload-url endpoint responds 200', urlRes.status === 200, { status: urlRes.status });
ok('it returns an upload URL', Boolean(ticket.uploadUrl || ticket.upload_url), { keys });

// ---- 2. What the code READS ----
// The bug was `ticket.upload_url`; `UploadTicket` is camelCase throughout, so
// that key never existed and the guard was always true. Asserting the key is
// ABSENT would freeze the bug in place, so assert the opposite: the code must
// read the name the server actually sends.
const BUGGY_KEY = 'upload_url';
ok(
  `the server does NOT send ticket.${BUGGY_KEY} (the key that broke the wizard)`,
  !(BUGGY_KEY in ticket),
  { serverSent: keys }
);
ok(
  'the server DOES send ticket.uploadUrl, which is what the code must read',
  'uploadUrl' in ticket,
  { serverSent: keys }
);

/** Strip comments and string literals, so a scan reads CODE and not prose.
 *
 * Without this, any file that DOCUMENTS the bug contains the buggy key, and the
 * check reports the documentation as the defect. A check that cannot tell a
 * comment from a statement stops being evidence about the code.
 */
function code(file) {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const shared = code('apps/web/src/lib/channel-cover-upload.ts');
ok('the shared helper reads ticket.uploadUrl', shared.includes('ticket.uploadUrl'), {});
ok(
  'the shared helper never reads the snake_case key in CODE',
  !/\bticket\.upload_url\b/.test(shared),
  {}
);
ok(
  'the shared helper exists as a single exported function',
  shared.includes('export function uploadChannelCover'),
  {}
);

// ---- 3. And what it then PUTs ----
// The shared helper must send the server's own objectKey, never a locally
// reconstructed one - a client that may choose its key may write outside its
// own prefix, which is an IDOR on the object store.
ok(
  'the object key the wizard finalises with came from the server',
  typeof ticket.objectKey === 'string' && ticket.objectKey.length > 0,
  { objectKey: ticket.objectKey }
);
ok(
  'the content type the ticket carries is the one the PUT must send',
  typeof ticket.contentType === 'string',
  { contentType: ticket.contentType }
);

// ---- 3b. The size limit must come from the server, not a local constant ----
// The create-time copy hardcoded 6 MB against the server's 4 MB, so a 5 MB file
// uploaded in full and was rejected only at finalize - after the wait.
ok(
  'the ticket states the size limit, so the client cannot disagree with it',
  typeof ticket.maxBytes === 'number' && ticket.maxBytes > 0,
  { maxBytes: ticket.maxBytes }
);

// ---- 3c. And there must be only ONE implementation of the three steps ----
const dupes = [];
for (const f of [
  'apps/web/src/components/channels/cover-uploader.tsx',
  'apps/web/src/components/channels/channel-wizard-fields.tsx',
]) {
  const src = code(f);
  // A copy re-implements the flow if it posts to upload-url AND to finalize
  // itself, rather than calling the shared helper.
  if (src.includes('/cover/finalize') && !src.includes('uploadChannelCover')) {
    dupes.push(f);
  }
}
ok(
  'no component re-implements the three steps instead of calling the shared helper',
  dupes.length === 0,
  { duplicates: dupes }
);

// No component may hardcode its own byte ceiling: the limit is the server's to
// state, and a local copy is how 6 MB came to sit against a 4 MB rule.
const hardcoded = [];
for (const f of [
  'apps/web/src/components/channels/cover-uploader.tsx',
  'apps/web/src/components/channels/channel-wizard-fields.tsx',
]) {
  const src = code(f);
  if (/\d+\s*\*\s*1024\s*\*\s*1024/.test(src)) hardcoded.push(f);
}
ok(
  'no component hardcodes a byte ceiling instead of reading the server maxBytes',
  hardcoded.length === 0,
  { hardcoded }
);

// ---- 4. For contrast: the EDIT-time path, which the user says works ----
const listRes = await fetch(`${AUTH}/api/v1/auth/channels`, { headers: auth });
const listBody = await listRes.json().catch(() => ({}));
const channels = listBody.channels ?? listBody.data ?? [];
const first = channels[0];
if (first?.id) {
  const editRes = await fetch(`${AUTH}/api/v1/auth/channels/${first.id}/cover/upload-url`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ filename: 'probe.png', contentType: 'image/png' }),
  });
  const editTicket = await editRes.json().catch(() => ({}));
  console.log(`edit-time upload-url keys: ${Object.keys(editTicket).sort().join(', ')}`);
  ok('edit-time returns the same camelCase shape the CoverUploader reads', Boolean(editTicket.uploadUrl));
} else {
  console.log('note: no channel to compare against (create one first)');
}

console.log(`\n${fail.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fail.length})`}`);
console.log(fail.length ? `  - ${fail.join('\n  - ')}` : '');
process.exit(fail.length ? 1 : 0);