#!/usr/bin/env node
// check-app-gates.mjs
//
// Proves, against the RUNNING containers, that every app's session gate
// actually blocks an unauthenticated request.
//
// =============================================================================
// WHY THIS FILE EXISTS
// =============================================================================
//
// Six of eight apps had no effective gate. `monitor` and `admin` each had a
// middleware that looked like a guard and was not:
//
//     const publicPaths = ['/', '/login', '/signup', '/api/auth'];
//     const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));
//
// `'/'` is a prefix of every path, so `isPublicPath` was always true, so the
// redirect never fired. Verified, not assumed:
//
//     GET http://localhost:3001/api/metrics   ->  200
//     {"containersUp":9,"cpuCores":0.53,"memoryGB":4.02,
//      "prometheusUrl":"http://prometheus:9090", ...}
//
// Internal topology - container count, host resources, a bucket name and an
// INTERNAL HOSTNAME - with no credential.
//
// =============================================================================
// WHY A LIVE CHECK AND NOT A UNIT TEST
// =============================================================================
//
// A unit test of `createGate` proves `createGate` works. It does not prove an app
// USES it, that the app has `JWT_SECRET_KEY` in its environment, or that the
// container running the image is the one you just built.
//
// All three have been wrong at some point in this repo. A green unit suite over a
// gate that four apps never import is the exact shape of the failure this check
// exists to catch.
//
// So every assertion here is: make the request, look at the status code.
//
// The two failure shapes it distinguishes, because they need different fixes:
//
//   - a gate that LETS a request through -> the middleware is missing or a no-op
//   - a gate that blocks EVERYTHING, signed in too -> the secret is not plumbed,
//     which is fail-CLOSED working correctly and is a deployment bug, not a
//     security bug
//
// Usage:  node tools/check-app-gates.mjs

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const AUTH = process.env.AUTH_URL ?? 'http://localhost:8085';
const EMAIL = process.env.HARNESS_EMAIL ?? 'harness@wideo11.test';
const PASSWORD = process.env.HARNESS_PASSWORD ?? 'Harness-Pass-2026!x';

let pass = 0;
const fails = [];
const check = (label, ok, detail) => {
  if (ok) {
    pass++;
    console.log(`PASS  ${label}`, detail ? JSON.stringify(detail) : '');
  } else {
    fails.push(label);
    console.log(`FAIL  ${label}`, detail ? JSON.stringify(detail) : '');
  }
};

/**
 * Each app, and what must happen with NO credential.
 *
 * `blocked` is `401` for API routes (JSON) and for pages where `loginPath: null`
 * was chosen. It is NOT a redirect: none of these apps has a login page, so a
 * redirect would be a 404 that reads as a broken gate.
 *
 * `allow` names the one thing each app is entitled to serve without a session, and
 * every one of those is a deliberate, reviewed exception - which is why they are
 * listed here rather than being quietly absent.
 */
const APPS = [
  {
    // OPEN, and that is a decision rather than a gap - see monitor's middleware
    // header for the reasoning.
    //
    // The page needs `/api/metrics` to render anything, so gating the API means a
    // dashboard that loads and shows nothing. What actually leaked was ONE FIELD -
    // `prometheusUrl`, an internal container hostname - and that is fixed in the
    // payload instead, which is the only version of the fix that leaves the tool
    // usable.
    name: 'monitor',
    port: 3001,
    // Nothing to refuse - the whole surface is deliberately public. Listed under
    // `allow` rather than omitted, so the decision is visible here instead of being
    // an absence somebody has to reverse-engineer.
    probes: [],
    allow: [
      { path: '/', label: 'the page' },
      { path: '/api/metrics', label: 'host metrics' },
      { path: '/api/live', label: '/api/live' },
    ],
    // The specific disclosure the gate was introduced for, checked directly.
    mustNotContain: [
      {
        path: '/api/metrics',
        field: 'prometheusUrl',
        why:
          'an internal container hostname. The browser cannot resolve it, so no UI ' +
          'uses it, and sending it publishes the Docker network topology. It is a ' +
          'server constant, logged server-side, and never in a response.',
      },
    ],
  },
  {
    name: 'admin',
    port: 3004,
    probes: [
      { path: '/api/telemetry', label: 'the telemetry WRITE endpoint' },
      { path: '/api/audit', label: 'the audit ledger' },
      { path: '/', label: 'the page' },
    ],
    // A load balancer has no session and must be able to ask "is this up".
    allow: [{ path: '/api/health-check', label: 'the liveness probe' }, { path: '/api/live', label: '/api/live' }],
  },
  {
    name: 'billing',
    port: 3003,
    probes: [{ path: '/', label: 'the page' }],
    allow: [{ path: '/api/live', label: '/api/live' }],
  },
  {
    name: 'analytics',
    port: 3005,
    probes: [{ path: '/', label: 'the page' }],
    allow: [{ path: '/api/live', label: '/api/live' }],
  },
  {
    name: 'currency',
    port: 3007,
    probes: [
      { path: '/api/refresh', label: 'the upstream-currency REFRESH' },
      { path: '/api/rates', label: 'the rates read' },
      { path: '/', label: 'the page' },
    ],
    allow: [{ path: '/api/live', label: '/api/live' }],
  },
  {
    name: 'superadmin',
    port: 3008,
    probes: [
      { path: '/api/security', label: 'platform security posture' },
      { path: '/api/ledger', label: 'the audit ledger' },
      { path: '/', label: 'the page' },
    ],
    allow: [{ path: '/api/live', label: '/api/live' }],
  },
];

/**
 * A signed-in token, for the "does the gate lock everyone out" half.
 *
 * The harness user is NOT a superadmin, so `superadmin`'s role gate should still
 * refuse it - which is itself worth asserting, because a role gate that admits
 * everybody because the role check never ran looks identical to a working one from
 * the outside.
 */
async function harnessToken() {
  const res = await fetch(`${AUTH}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return { token: null, limited: true };
  return { token: body?.tokens?.access_token ?? null, limited: false };
}

const { token, limited } = await harnessToken();
check(
  limited || token ? 'a harness session is available for the signed-in half' : 'a harness session is available for the signed-in half',
  Boolean(token),
  limited ? { note: 'rate limited - the signed-in half is skipped' } : {}
);

// ---------------------------------------------------------------------------
// 1. Unauthenticated: everything protected must be REFUSED
// ---------------------------------------------------------------------------
for (const app of APPS) {
  const base = `http://localhost:${app.port}`;

  for (const probe of app.probes) {
    const res = await fetch(`${base}${probe.path}`, { redirect: 'manual' }).catch(() => null);
    const status = res?.status ?? 'no response';

    // 401 is refused. 403 is refused for the superadmin role gate, which is also
    // correct. A REDIRECT is NOT accepted here: none of these apps has a login
    // page, so a redirect means `loginPath: null` was not honoured.
    const refused = status === 401 || status === 403;
    check(
      `${app.name}: ${probe.label} is refused without a credential`,
      refused,
      {
        path: probe.path,
        status,
        redirectTo: res?.headers?.get('location') ?? null,
        why:
          status === 200
            ? 'NO GATE. This is the original failure: a middleware whose public list ' +
              'contains "/" matches every path, so it never fires.'
            : refused
              ? null
              : `expected 401/403, got ${status}`,
      }
    );
  }

  for (const open of app.allow) {
    const res = await fetch(`${base}${open.path}`, { redirect: 'manual' }).catch(() => null);
    const status = res?.status ?? 'no response';

    /*
     * "Not gated" is the claim - NOT "healthy".
     *
     * The first version asserted `status < 400`, which conflated two different
     * questions. `admin`'s liveness probe answers **503**, and that is the gate
     * working perfectly: it let a credential-less request reach the route, and the
     * route then reported that something it depends on is down.
     *
     * Asserting `< 400` would have called that a gate failure - i.e. reported a
     * working security control as broken because the service behind it is
     * unhealthy. The two failures need different fixes and must not share a check.
     *
     * So the test is: the gate did not answer 401 or 403.
     */
    const gated = status === 401 || status === 403;
    check(
      `${app.name}: ${open.label} is deliberately reachable without a credential`,
      !gated,
      {
        path: open.path,
        status,
        note: gated
          ? 'the gate is BLOCKING a route its own configuration marks public'
          : status >= 500
            ? `the gate let it through, and the route answered ${status} - the route is ` +
              'unhealthy, which is a DIFFERENT bug from the gate and needs a different fix'
            : null,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// 2. The leak, checked by name
// ---------------------------------------------------------------------------
// Asserted separately from the loop above because it is the finding that matters,
// and because "the gate is closed" and "the hostname is gone" are DIFFERENT claims.
//
// The first version checked both `prometheusUrl` AND `containersUp`, and failed on
// `containersUp`:
//
//     monitor no longer publishes the internal Prometheus address or host metrics
//     {"leaked":{"containersUp":9}}
//
// It was reporting a host resource count as a disclosure, on an app that has since
// been opened deliberately - because the dashboard is a host resource dashboard
// and a container count is the number it exists to show. Closing the route would
// have hidden it from the operator who runs the machine.
//
// So the check is narrowed to the one value that was never needed by a browser:
// the internal container hostname, which nothing can resolve client-side and which
// publishes the network topology. That is the actual secret, and it is now a
// `mustNotContain` entry above.
{
  const res = await fetch('http://localhost:3001/api/metrics').catch(() => null);
  let leaked = null;
  if (res && res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body.prometheusUrl) leaked = { prometheusUrl: body.prometheusUrl };
  }
  check(
    'monitor does not publish the internal Prometheus address',
    leaked === null,
    {
      leaked,
      why: 'an internal hostname plus the ability to query it is Docker network ' +
        'topology published to anyone who can reach the port',
    }
  );
}

// ---------------------------------------------------------------------------
// 2. Fields that must never appear in a response
// ---------------------------------------------------------------------------
// A gate is the coarse control. This is the fine one: a specific value that must
// not reach a browser, checked on the bytes rather than on the status code.
//
// `monitor` is deliberately OPEN (see its middleware header), so the internal
// Prometheus hostname is kept out of the PAYLOAD instead of the route. That is
// only honest if something checks it - otherwise "we fixed it" is a claim with no
// evidence behind it, and the field is one `return` away from coming back.
for (const app of APPS) {
  for (const spec of app.mustNotContain ?? []) {
    const res = await fetch(`http://localhost:${app.port}${spec.path}`).catch(() => null);
    let body = null;
    try {
      body = res ? await res.json() : null;
    } catch {
      body = null;
    }
    const present = body && Object.prototype.hasOwnProperty.call(body, spec.field);
    check(
      `${app.name}: ${spec.path} does not publish ${spec.field}`,
      !present,
      {
        status: res?.status ?? 'no response',
        present: Boolean(present),
        why: spec.why,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// 2b. A GATED APP THAT RENDERS UNSTYLED IS STILL BROKEN
// ---------------------------------------------------------------------------
// The worst class of bug in this repo, and the reason this block exists.
//
// `createGate` had no `config.matcher`, so it ran on EVERY path - including
// `/_next/static/css/<hash>.css`, which is a build artifact with no session and is
// never requested by a browser session. The gate answered 401 to it, the browser
// discarded it, and the monitor dashboard rendered as unstyled HTML:
//
//     Wideo11 Monitoring
//     CPU     n/a
//     Memory  n/a
//
// Every status code the previous checks looked at was 200. The HTML was correct.
// The data was correct. The page looked like a 1998 website and nothing in any
// log said why.
//
// So: fetch the page, read its stylesheet href, fetch THAT, and require it to
// actually be CSS. A gated app whose stylesheet 401s is broken, and no amount of
// status-code checking on the page itself will show it.
for (const app of APPS) {
  const base = `http://localhost:${app.port}`;
  const html = await fetch(`${base}/`).then((r) => (r.ok ? r.text() : '')).catch(() => '');
  const href = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1];
  if (!href) {
    check(`${app.name}: the page ships a stylesheet`, false, {
      why: 'no <link rel=stylesheet> in the document - the app will render unstyled',
    });
    continue;
  }

  const css = await fetch(`${base}${href}`).catch(() => null);
  const body = (await css?.text().catch(() => '')) ?? '';
  const isCss = (css?.headers?.get('content-type') ?? '').includes('text/css');

  check(`${app.name}: the stylesheet actually loads`, Boolean(css?.ok) && isCss, {
    href,
    status: css?.status ?? 'no response',
    contentType: css?.headers?.get('content-type') ?? null,
    bytes: body.length,
    // A 200 that is HTML is the giveaway: the gate redirected the asset to the
    // login page, which "succeeds" and leaves the page unstyled.
    looksLikeHtml: /^\s*<!DOCTYPE|<html/i.test(body),
    why:
      css?.status === 401 || css?.status === 403
        ? 'THE GATE IS REFUSING A BUILD ARTIFACT. `export const config = { matcher }` is ' +
          'missing from this app\'s middleware - see GATE_MATCHER.'
        : null,
  });

  check(`${app.name}: the stylesheet is not empty`, body.length > 500, {
    bytes: body.length,
    why: 'a near-empty stylesheet means Tailwind produced no utilities - check the content globs',
  });
}

// ---------------------------------------------------------------------------
// 3. Signed in: the gate must not lock EVERYONE out
// ---------------------------------------------------------------------------
// `createGate` fails CLOSED when `JWT_SECRET_KEY` is absent. That is correct for a
// security control and catastrophic as a missing env var - so this half exists to
// tell those two apart. A gate that blocks a valid session is a deployment bug,
// and reporting it as "secured" would be the worst possible outcome.
if (token) {
  const cookie = `wideo11_session=${token}`;
  const results = [];
  for (const app of APPS) {
    // An app whose whole surface is public has no route left to probe with a
    // session - and that is the correct outcome, not a missing check.
    const gated = app.probes.filter((p) => !app.allow.some((a) => a.path === p.path));
    if (gated.length === 0) continue;

    const res = await fetch(`http://localhost:${app.port}${gated[0].path}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
    }).catch(() => null);
    const status = res?.status ?? 'no response';
    results.push({ app: app.name, status });
  }

  // The non-superadmin apps must let a valid session through. If they 401, the
  // secret is not in their environment.
  const blockedButShouldPass = results.filter(
    (r) => r.app !== 'superadmin' && (r.status === 401 || r.status === 403)
  );
  check(
    'a valid session is ACCEPTED by the non-superadmin apps - the secret is plumbed',
    blockedButShouldPass.length === 0,
    {
      blockedButShouldPass,
      results,
      why: blockedButShouldPass.length
        ? 'fail-CLOSED with no secret means every user is locked out. That is the gate ' +
          'working; the BUG is JWT_SECRET_KEY missing from that app\'s environment.'
        : null,
    }
  );

  // And superadmin must still refuse a NON-superadmin session. A role gate that
  // admits everybody because the role check never ran is indistinguishable from a
  // working one until you test it with the wrong person.
  const sa = results.find((r) => r.app === 'superadmin');
  check(
    'superadmin still refuses a NON-superadmin session - the role check ran',
    sa?.status === 403,
    {
      status: sa?.status,
      why:
        sa?.status === 401 || sa?.status === 200
          ? sa?.status === 200
            ? 'the harness user is not a superadmin and was ADMITTED. requireRole is not ' +
              'being enforced.'
            : '401 here means the session itself was refused, so the role check was never ' +
              'reached and is still unproven.'
          : null,
    }
  );
}

console.log(`\n${pass}/${pass + fails.length} checks passed`);
console.log(fails.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails.length})`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length ? 1 : 0);