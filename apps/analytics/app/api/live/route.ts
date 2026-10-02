import { NextResponse } from 'next/server';

/**
 * LIVENESS PROBE - "is this process alive and serving?"
 *
 * =============================================================================
 * WHY THIS ROUTE EXISTS
 * =============================================================================
 *
 * Every app here runs behind a session gate, so EVERY route answers 401 without a
 * credential - including `/`. Docker's health check was probing `/`:
 *
 *     wget --spider -q http://127.0.0.1:PORT/ || exit 1
 *
 * and the six containers went unhealthy within one health interval:
 *
 *     wget: server returned error: HTTP/1.1: 401 Unauthorized
 *
 * The gate was right. A liveness probe is not a user request - it is Docker asking
 * whether the process started and is still serving, and there is nobody to log in
 * as. Answering 401 makes Docker kill a healthy app after `retries` failures.
 *
 * The tempting shortcut is to exempt `/` for loopback. That is not available and
 * would be wrong anyway: "is this request from this container" is not something the
 * gate can know, and a route open to anything carrying a spoofable loopback header
 * is not a route.
 *
 * =============================================================================
 * WHAT THIS DELIBERATELY DOES NOT RETURN
 * =============================================================================
 *
 *   NO DATABASE QUERY. A liveness probe that checks the database reports the
 *   DATABASE as unhealthy, and Docker restarts the app to fix something it cannot
 *   fix. Whether the app is READY to take traffic is a separate question with a
 *   separate endpoint.
 *
 *   NO dependencies, NO version, NO build id, NO hostname, NO uptime. Anything
 *   that can change makes the probe flap for a reason unrelated to "is this alive".
 *
 * So it leaks nothing beyond the fact that a process is on this port - which is
 * also what an open TCP port already says.
 *
 * It is listed as a public path in this app's `middleware.ts`, and
 * `tools/check-app-gates.mjs` asserts it is reachable WITHOUT a credential.
 */

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'ok' },
    // Never cached. A cached 200 that outlives the process is a probe that passes
    // for a container that is not running.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
