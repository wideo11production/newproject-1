import { NextResponse } from 'next/server';

// ============================================================================
// /api/analytics - server-side data source for the analytics dashboard
// ============================================================================
//
// ---- WHY THIS ROUTE EXISTS ----
//
// Every one of the six analytics panels was a hardcoded array. Real example
// from `overview-panel.tsx` before this was written:
//
//   { label: 'Total Views', value: '1.2M', change: '+12.5%' }
//   { label: 'Revenue',    value: '$45.2K', change: '+15.3%' }
//   { title: 'How to Edit Like a Pro', views: '245K', creator: 'John Doe' }
//
// and `creator-insights.tsx` had five invented creators with subscriber counts
// and revenue. `page.tsx` went one step further and did not import those
// components at all - it defined six inline stubs rendering "X analytics are
// unavailable", on the stated grounds that "the module is not present". It
// was present the whole time; the stubs were hiding working-shaped UI and the
// working-shaped UI was full of fiction.
//
// The real data lives in Postgres behind auth-service:
//   users, user_registrations, click_events, security_events
// reachable through the superadmin-gated awareness endpoints.
//
// ---- WHY SERVER-SIDE AND NOT A DIRECT BROWSER FETCH ----
//
// The awareness endpoints require a superadmin bearer token. If the browser
// called them directly it would need that token, which means an admin token
// in client JavaScript - readable by any script on the page, and by any
// extension.
//
// Instead the browser sends ITS OWN session token, this route forwards it, and
// the token never becomes an admin credential in the browser. If the caller is
// not a superadmin, auth-service returns 403 and the dashboard says so rather
// than showing numbers it cannot justify.
//
// Same reason the monitor dashboard never renders `http://prometheus:9090`:
// internal addresses and privileged credentials stay on the server.
// ============================================================================

export const dynamic = 'force-dynamic';

const AUTH_INTERNAL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

/** Forward a bearer token to auth-service and pass the result through. */
async function forward(path: string, token: string | null) {
  if (!token) {
    return { status: 401, body: { error: 'sign_in_required' } };
  }
  try {
    const res = await fetch(`${AUTH_INTERNAL}${path}`, {
      headers: { Authorization: token },
      cache: 'no-store',
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: 'upstream returned non-JSON' };
    }
    return { status: res.status, body };
  } catch (err) {
    // Upstream unreachable is NOT the caller's fault and must not look like
    // "no data" - that would hide a broken deployment behind an empty panel.
    return {
      status: 502,
      body: {
        error: 'upstream_unavailable',
        message: err instanceof Error ? err.message : 'auth-service unreachable',
      },
    };
  }
}

export async function GET(request: Request) {
  const token = request.headers.get('authorization');

  const [overview, registrations, clicks] = await Promise.all([
    forward('/api/v1/auth/admin/awareness', token),
    forward('/api/v1/auth/admin/registrations?limit=100', token),
    // NOTE: the real path is `/admin/clicks`, not `/admin/click-events`.
    // `click-events` is the PUBLIC POST endpoint that records activity; the
    // superadmin read path is a different route entirely. Getting these two
    // confused is easy - they sound interchangeable and are not.
    forward('/api/v1/auth/admin/clicks?limit=100', token),
  ]);

  // 403 from any of them means "not a superadmin". Surface that distinctly so
  // the UI can say "sign in as superadmin" instead of showing empty panels,
  // which would read as "no users yet" and be plainly wrong.
  const denied = [overview, registrations, clicks].some((r) => r.status === 403);
  const signedOut = [overview, registrations, clicks].some((r) => r.status === 401);
  if (denied) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Analytics are restricted to superadmins.' },
      { status: 403 }
    );
  }
  if (signedOut) {
    return NextResponse.json(
      { error: 'sign_in_required', message: 'Sign in to view analytics.' },
      { status: 401 }
    );
  }

  const overviewBody = overview.body as Record<string, unknown>;
  const regsBody = registrations.body as Record<string, unknown>;
  const clicksBody = clicks.body as Record<string, unknown>;

  return NextResponse.json(
    {
      overview: {
        totalUsers: num(overviewBody.total_users),
        totalVerified: num(overviewBody.total_verified),
        totalUnverified: num(overviewBody.total_unverified),
        totalRegistrations: num(overviewBody.total_registrations),
        signupsByDay: rows(overviewBody.signups_by_day),
        byDevice: mapOfNumbers(overviewBody.by_device),
        byBrowser: mapOfNumbers(overviewBody.by_browser),
        byOs: mapOfNumbers(overviewBody.by_os),
        byCountry: mapOfNumbers(overviewBody.by_country),
        byContinent: mapOfNumbers(overviewBody.by_continent),
        countriesMissing: num(overviewBody.countries_missing),
      },
      registrations: Array.isArray(regsBody.registrations) ? regsBody.registrations : [],
      clicks: Array.isArray(clicksBody.events) ? clicksBody.events : [],
      fetchedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Accepts either an object map or an array of {key,value} pairs. */
function mapOfNumbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      const r = item as Record<string, unknown>;
      const k = String(r.key ?? r.name ?? r.device ?? r.os ?? r.browser ?? '');
      if (k) out[k] = num(r.value ?? r.count);
    }
  } else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = num(val);
    }
  }
  return out;
}

function rows(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}
