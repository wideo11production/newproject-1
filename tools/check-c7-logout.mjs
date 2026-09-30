// ============================================================================
// Phase C7 end-to-end proof: does logout delete ONE device or ALL of them?
// ============================================================================
//
// This talks to the RUNNING auth-service over HTTP. It registers a throwaway
// user, signs in from two devices, logs out of ONE, and then checks three
// things:
//
//   1. the logged-out device's session row is GONE from the database
//   2. the OTHER device still works (a live request succeeds)
//   3. how many milliseconds the delete took
//
// Point 2 is the whole sprint. `RevokeAllByUserID` used to make it fail: the
// phone's logout killed the laptop too, and nothing surfaced that number, so
// it looked fine.
import { execSync } from 'node:child_process';

const BASE = process.argv[2] ?? 'http://localhost:8085';
const API = `${BASE}/api/v1/auth`;
const stamp = Date.now();
const EMAIL = `c7-probe-${stamp}@test.local`;
const PASSWORD = 'Str0ng-Passw0rd!';

const device = (name, fingerprint) => ({
  device_name: name,
  device_type: 'desktop',
  platform: 'linux',
  browser: 'chrome',
  fingerprint,
});

async function call(path, body, token, method = 'POST') {
  const started = performance.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const wallMs = performance.now() - started;
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* an empty body is itself a result */
  }
  return { status: res.status, json, wallMs };
}

const psql = (sql) =>
  execSync(
    `docker exec wideo11-postgres psql -U postgres -d auth_service -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${JSON.stringify(detail)}` : ''}`);
};

// ---- 1. register -----------------------------------------------------------
// `username` bhi zaroori hai (3..30 chars) - uske bina register 400 deta hai.
const USERNAME = 'c7' + String(stamp).slice(-6);
const reg = await call('/register', { email: EMAIL, password: PASSWORD, full_name: 'C7 Probe', username: USERNAME });
check('register a throwaway user', reg.status === 200 || reg.status === 201, {
  status: reg.status,
  needsVerification: Boolean(reg.json?.needs_verification),
});

// Login 403 deta hai jab tak email verify na ho (`ErrUserNotVerified`).
// Probe ke liye seedha verify kar dete hain - is test ka maqsad logout
// isolation hai, verification email ka flow usmein koi role nahi rakhta, aur
// uske liye mail service ka Inbox padhna ek aur moving part ho jata.
if (reg.status === 200 || reg.status === 201) {
  execSync(
    `docker exec wideo11-postgres psql -U postgres -d auth_service -c "UPDATE users SET is_verified = true WHERE email = '${EMAIL}';"`,
    { stdio: 'ignore' }
  );
}

// ---- 2. sign in from TWO devices ------------------------------------------
const loginA = await call('/login', { email: EMAIL, password: PASSWORD, device: device('probe-A', `c7-A-${stamp}`) });
const loginB = await call('/login', { email: EMAIL, password: PASSWORD, device: device('probe-B', `c7-B-${stamp}`) });

const tokenA = loginA.json?.tokens?.access_token ?? loginA.json?.access_token;
const tokenB = loginB.json?.tokens?.access_token ?? loginB.json?.access_token;
check('sign in from two separate devices', Boolean(tokenA && tokenB), {
  statusA: loginA.status,
  statusB: loginB.status,
  a: Boolean(tokenA),
  b: Boolean(tokenB),
});

if (tokenA && tokenB) {
  // ---- 3. both sessions exist and are bound to their own refresh tokens ----
  const bound = psql(
    `SELECT count(*) FROM refresh_tokens rt JOIN sessions s ON s.id = rt.session_id WHERE s.user_id = (SELECT id FROM users WHERE email = '${EMAIL}') AND rt.revoked_at IS NULL;`
  );
  check('each refresh token is bound to a session (migration 013)', Number(bound[0]) >= 2, {
    boundRows: Number(bound[0]),
  });

  const liveSessions = () =>
    Number(
      psql(`SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = '${EMAIL}' AND s.revoked_at IS NULL;`)[0]
    );
  const sessionsBefore = liveSessions();

  // ---- 4. the OTHER device works BEFORE logout ----------------------------
  const beforeB = await call('/sessions', undefined, tokenB, 'GET');
  check("the second device is live before logout", beforeB.status === 200, { status: beforeB.status });

  // ---- 5. log out of ONE device, and time it ------------------------------
  const out = await call('/logout', {}, tokenA);
  check('logout returns 200', out.status === 200, { status: out.status });
  check(
    'logout reports the sessions it left running',
    typeof out.json?.remaining_sessions === 'number' && out.json.remaining_sessions >= 1,
    { remaining_sessions: out.json?.remaining_sessions, deleted_refresh_tokens: out.json?.deleted_refresh_tokens }
  );
  check(
    `logout deleted the token inside ${out.json?.elapsed_ms} ms`,
    typeof out.json?.elapsed_ms === 'number' && out.json.elapsed_ms >= 0 && out.json.elapsed_ms < 5000,
    { server_elapsed_ms: out.json?.elapsed_ms, client_round_trip_ms: Math.round(out.wallMs) }
  );

  // ---- 6. THE REGRESSION GUARD --------------------------------------------
  const afterB = await call('/sessions', undefined, tokenB, 'GET');
  check('the OTHER device still works after logout (cross-device isolation)', afterB.status === 200, {
    status: afterB.status,
    body: afterB.json?.error ?? null,
  });

  const afterA = await call('/sessions', undefined, tokenA, 'GET');
  check('the logged-out device is rejected', afterA.status === 401, { status: afterA.status });

  // ---- 7. the row is GONE, not just flagged -------------------------------
  // Relative, not absolute: register itself may also open a session, and
  // pinning an exact number makes the test assert the wrong thing.
  const sessionsAfter = liveSessions();
  check('exactly one session row was hard-deleted', sessionsAfter === sessionsBefore - 1, {
    sessionsBefore,
    sessionsAfter,
  });
}

// ---- 8. clean up -----------------------------------------------------------
execSync(`docker exec wideo11-postgres psql -U postgres -d auth_service -c "DELETE FROM users WHERE email = '${EMAIL}';"`, {
  stdEncoding: 'utf8',
  stdio: 'ignore',
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} C7 checks passed`);
if (failed.length) process.exitCode = 1;
