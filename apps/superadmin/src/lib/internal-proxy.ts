// Superadmin-gated relay to the INTERNAL infrastructure tools.
//
// =============================================================================
// WHY THIS EXISTS (and why the ports are closed instead)
// =============================================================================
//
// Prometheus (:9090), Alertmanager (:9093) and the MinIO console (:9001) used to
// be published on 0.0.0.0 - anyone on the network could open them, read every
// metric, and see the whole topology. They are now bound to 127.0.0.1, which
// closes them to the LAN but also to the operator who is not sitting on the box.
//
// This relay is the answer: the internal tools stay unreachable directly, and a
// superadmin reaches them through this app - which authenticates every relayed
// request against auth-service and checks the ROLE before a single byte is
// forwarded. It is the same order `telemetry-proxy.ts` uses, for the same reason:
// authentication is not authorisation.
//
// =============================================================================
// THE ALLOWLIST IS THE WHOLE GAME
// =============================================================================
//
// A relay that builds its upstream from the caller's path is an open proxy to
// the entire docker network - `/api/admin/metrics/../auth-service:8085/...` and
// the internal DNS map is published. So the upstream is chosen from a fixed map
// by ROUTE, never by request content, and the forwarded path is restricted to
// the prefixes each tool actually serves.

import { NextResponse } from 'next/server';
import { requireSuperadmin, bearerFromRequest } from './telemetry-proxy';

/**
 * The only upstreams this app will talk to, keyed by route segment.
 *
 * Adding an entry is a deliberate act with a name, not a side effect of a URL
 * somebody typed. Each entry lists the path prefixes it will forward.
 */
const UPSTREAMS = {
  metrics: {
    base: process.env.PROMETHEUS_INTERNAL_URL ?? 'http://prometheus:9090',
    // The read-only Prometheus HTTP API. `/targets` and `/runtimeinfo` describe
    // the deployment but carry no secrets; `/admin` (TSDB tools) is deliberately
    // NOT forwarded.
    allow: ['/api/v1/query', '/api/v1/query_range', '/api/v1/targets', '/api/v1/runtimeinfo', '/api/v1/alerts', '/-/healthy', '/-/ready'],
    label: 'metrics service',
  },
  alerts: {
    base: process.env.ALERTMANAGER_INTERNAL_URL ?? 'http://alertmanager:9093',
    allow: ['/api/v2/alerts', '/api/v2/silences', '/-/healthy', '/-/ready'],
    label: 'alert manager',
  },
  storage: {
    base: process.env.MINIO_INTERNAL_URL ?? 'http://minio:9000',
    // Health and readiness ONLY. The MinIO admin API needs SigV4 signing this
    // relay cannot do honestly, and the console is a SPA whose assets are not
    // safely relayable - so "storage console" here means liveness, which is what
    // an operator dashboard needs. Deeper admin work stays a port-forward.
    allow: ['/minio/health/live', '/minio/health/ready', '/minio/metrics/v3/cluster'],
    label: 'object storage',
  },
} as const;

type UpstreamKey = keyof typeof UPSTREAMS;

/** Does `path` start with any of `allow`'s prefixes? Path-escape safe. */
function isAllowedPath(path: string, allow: readonly string[]): boolean {
  // Normalise before matching: a `..` segment that survived a router would turn
  // `/api/v1/query` into `/../admin` between this check and the fetch.
  const clean = new URL(path, 'http://relative.invalid').pathname;
  return allow.some((p) => clean === p || clean.startsWith(p + '?') || clean.startsWith(p + '/'));
}

/**
 * Relay a request to an internal tool after a superadmin check.
 *
 * @param key     which upstream (the allowlist key)
 * @param path    path on that upstream; MUST pass the allowlist
 * @param request the incoming request, for the caller's credential and query
 */
/**
 * Relay a request to an internal tool after a superadmin check.
 *
 * @param key     which upstream (the allowlist key)
 * @param path    path on that upstream; MUST pass the allowlist
 * @param request the incoming request, for the caller's credential
 * @param searchOverride optional `?a=b` to send INSTEAD of the caller's raw
 *                search - for routes that need to strip routing hints before
 *                forwarding. Without it the caller's search is passed verbatim.
 */
export async function relayToInternal(
  key: UpstreamKey,
  path: string,
  request: Request,
  searchOverride?: string,
): Promise<Response> {
  const guard = await requireSuperadmin(bearerFromRequest(request));
  if (!guard.ok) {
    return NextResponse.json(guard.body, { status: guard.status });
  }

  const upstream = UPSTREAMS[key];

  if (!isAllowedPath(path, upstream.allow)) {
    // 403 with NO upstream name. The caller is a verified superadmin, but a
    // relay that echoes which backend refused a path is a relay that maps the
    // internal network for whoever asks next.
    return NextResponse.json(
      { error: 'Forbidden', message: 'That path is not relayable' },
      { status: 403 },
    );
  }

  const qs = searchOverride ?? new URL(request.url).search;
  try {
    const res = await fetch(`${upstream.base}${path}${qs}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    // Pass the content type through: Prometheus and Alertmanager answer JSON,
    // MinIO health answers plain text. Re-typing everything as JSON breaks both.
    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    // Same rule as telemetry-proxy: a verified superadmin still does not learn
    // the internal address from an error message.
    return NextResponse.json(
      { error: 'Service Unavailable', message: `Cannot reach the ${upstream.label}` },
      { status: 503 },
    );
  }
}
