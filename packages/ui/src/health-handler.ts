// Shared dependency-health endpoint for every app in the monorepo.
//
// WHY THIS IS A LIBRARY AND NOT A FILE IN EACH APP
// -------------------------------------------------
//
// `apps/web` and `apps/admin` each carried a byte-identical copy of this route,
// and both copies leaked internal topology to anybody who asked. Copy-paste across
// a monorepo guarantees drift: the moment one copy is fixed, the other is
// silently wrong and nothing fails.
//
// Same pattern, same reason as `@wideo11/ui/audit-handler`. One implementation,
// each app's route is a three-line re-export.
//
// ----------------------------------------------------------------------------
// WHAT THE OLD COPY LEAKED, AND WHY IT LOOKED FINE
// ----------------------------------------------------------------------------
//
//     const services = [
//       { name: 'Recommendation Service', url: process.env.RECOMMENDATION_SERVICE_URL || 'http://localhost:8082' },
//       { name: 'Bot Service',             url: process.env.BOT_SERVICE_URL             || 'http://localhost:8080' },
//     ];
//     ...
//     return { service: service.name, status: 'ERROR', error: error.message }
//
// Four disclosures in one unauthenticated response:
//
//   1. INTERNAL SERVICE NAMES. "Recommendation Service", "Bot Service" - the
//      map of what exists behind this app. Reconnaissance, not a secret.
//   2. INTERNAL HOSTNAMES. `error.message` from a `fetch` failure embeds the URL
//      it could not reach: "fetch failed" plus, in some Node paths, the host. The
//      defaults (`localhost:8082`, `localhost:8080`) are the reverse-proxy port
//      map for the whole box, published to the internet.
//   3. PORT MAP. Each name is paired with a port, so the response is a working
//      scan list for anyone who can reach the app.
//   4. HONEST FAILURE AS A FREE ORACLE. A 200 means everything is up and a 503
//      means something is down, so the endpoint is a liveness oracle for services
//      the caller is not authorised to know about.
//
// Worst of all it was in `publicApiPrefixes`, so none of it needed a credential.
//
// The trap that let it survive review: it is named `health-check`, and a thing
// called "health check" is assumed to be harmless by definition. The name is what
// it does, not what it discloses.
//
// ----------------------------------------------------------------------------
// THE TWO ANSWERS, AND WHY THEY MUST NOT BE THE SAME ROUTE
// ----------------------------------------------------------------------------
//
//   /api/live          "is this process alive?"     - NO session, NO dependencies,
//                                                      NO version, NO hostname, NO
//                                                      uptime. Docker needs this and
//                                                      cannot log in as anybody.
//   /api/health-check  "are our dependencies up?"    - SESSION REQUIRED.
//
// They were the same route doing two jobs, which is why it could not be tightened:
// the load balancer's need was silently authorising the browser's need.
//
// A liveness probe that queries a dependency reports the DEPENDENCY as unhealthy,
// and Docker then restarts the app to fix a problem it cannot fix. Splitting them
// is what lets this one be locked down without breaking the healthchecks - the
// error recorded in `updatedtodo.md` SESSION 19, where six healthy containers were
// restarted into a loop because answering 401 to a probe was correct behaviour
// being applied to the wrong endpoint.
//
// ----------------------------------------------------------------------------
// WHAT THE RESPONSE MAY CONTAIN
// ----------------------------------------------------------------------------
//
// Names and statuses, yes - a session holder is entitled to know their own stack is
// up. Raw `error.message`, no: it is unfiltered server output, it changes with
// every dependency version, and it is the field that carried the hostnames.
//
// A fixed, closed set of error CODES replaces it. A code is stable, comparable and
// useless to an attacker; a message is none of those three things.

import { NextResponse } from 'next/server';

/**
 * Dependency status codes.
 *
 * A closed set, because the point of the map is that it cannot grow a field by
 * accident. Anything new needs a deliberate edit here.
 */
export type DependencyStatus = 'OK' | 'UNREACHABLE' | 'NOT_OK' | 'TIMEOUT';

export interface DependencyReport {
  /** Logical name, from a fixed server-side table. Never an env var's value. */
  service: string;
  status: DependencyStatus;
  /** Response time in ms. Present only for OK, so a timeout cannot report one. */
  latencyMs?: number;
  /**
   * Stable code. Deliberately NOT the upstream message - see the header.
   * Omitted entirely on success.
   */
  code?: 'HTTP_ERROR' | 'CONNECT_FAILED' | 'DEADLINE_EXCEEDED';
}

/**
 * The dependencies this app checks.
 *
 * Server-side, closed list, never derived from request input. `envVar` is read on
 * the server only - it is not `NEXT_PUBLIC_*`, and must not become one: a
 * browser-visible value cannot hold an internal address, because the browser
 * cannot resolve one.
 *
 * An entry whose `envVar` is unset is reported `UNREACHABLE` rather than skipped.
 * Silently omitting it would make "this deployment does not have that service"
 * look identical to "that service is healthy", which is the exact failure this
 * whole class of bug is about.
 */
const DEPENDENCIES: readonly { name: string; envVar: string }[] = [
  { name: 'auth', envVar: 'AUTH_INTERNAL_URL' },
  { name: 'billing', envVar: 'BILLING_INTERNAL_URL' },
];

/** Per-dependency budget. Long enough for a cold Go service, short enough to notice. */
const TIMEOUT_MS = 3000;

/**
 * @param overrides Replace the dependency table. Only tests pass this; an app
 *   that overrides it in production has re-opened the door this file closed, so
 *   the name says what it is for.
 */
export async function handleDependencyHealth(
  overrides?: readonly { name: string; envVar: string }[]
): Promise<NextResponse> {
  const deps = overrides ?? DEPENDENCIES;
  const checkedAt = new Date().toISOString();

  const services: DependencyReport[] = await Promise.all(
    deps.map(async (dep) => {
      const base = process.env[dep.envVar];

      if (!base) {
        return { service: dep.name, status: 'UNREACHABLE' as const, code: 'CONNECT_FAILED' as const };
      }

      const started = Date.now();
      // `AbortSignal.timeout` rather than a manual setTimeout: it also fires when
      // the socket is held open, which a bare timeout race does not.
      try {
        const res = await fetch(`${base.replace(/\/+$/, '')}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(TIMEOUT_MS),
      // Never followed. A redirect to an internal address, or to somewhere else
      // entirely, would make this endpoint an open proxy with a JSON parser.
      redirect: 'manual',
          cache: 'no-store',
          // A health check must never inherit the caller's credentials.
          credentials: 'omit',
        });

        if (res.status >= 300 && res.status < 400) {
          return { service: dep.name, status: 'NOT_OK' as const, code: 'HTTP_ERROR' as const };
        }
        if (!res.ok) {
          return { service: dep.name, status: 'NOT_OK' as const, code: 'HTTP_ERROR' as const };
        }
        return { service: dep.name, status: 'OK' as const, latencyMs: Date.now() - started };
      } catch (err) {
        // The one place where an error object could leak. Classified, never echoed.
        const timedOut =
          err instanceof Error &&
          (err.name === 'TimeoutError' || err.name === 'AbortError');
        return {
          service: dep.name,
          status: timedOut ? ('TIMEOUT' as const) : ('UNREACHABLE' as const),
          code: timedOut ? ('DEADLINE_EXCEEDED' as const) : ('CONNECT_FAILED' as const),
        };
      }
    })
  );

  const allOk = services.every((s) => s.status === 'OK');

  return NextResponse.json(
    { status: allOk ? 'OK' : 'DEGRADED', checkedAt, services },
    {
      // 200 even when degraded.
      //
      // A health check that answers 503 when a DEPENDENCY is down is a liveness
      // check wearing a readiness check's clothes: any orchestrator that restarts
      // on non-200 will restart this app forever over someone else's outage, and
      // restarting does not fix a database that is down. The operator needs to SEE
      // `DEGRADED`; a load balancer needs to see "this process is serving". Both
      // are true at once, and 200 with an honest status is the only reply that
      // says so.
      status: 200,
      // Never cache. A cached health answer is a lie with a timestamp on it.
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}