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
// Instead the browser sends NOTHING, this route reads the httpOnly session
// cookie itself and attaches the header, and the token never enters JavaScript
// at all. If the caller is not a superadmin, auth-service returns 403 and the
// dashboard says so rather than showing numbers it cannot justify.
//
// Same reason the monitor dashboard never renders `http://prometheus:9090`:
// internal addresses and privileged credentials stay on the server.
//
// ----------------------------------------------------------------------------
// YE PEHLE `Authorization` HEADER PADHTA THA, AUR BROWSER LOCALSTORAGE SE TOKEN
// BHEJTA THA
// ----------------------------------------------------------------------------
//
// `use-analytics.ts` imported `useAccessToken` from `packages/auth`, which
// persists BOTH the access token and the refresh token to `localStorage` under
// `w11-auth`. Iska matlab:
//
//   - Ek XSS - ya koi bhi extension, ya koi bhi CDN script jo compromise ho -
//     `localStorage` padhkar poora LIVE SESSION uthata hai. Refresh token ke
//     saath, yaani account takeover, aur wo bhi cookie ke httpOnly protection
//     ko bypass karke.
//
//   - Har app else par YAHI karta hai: cookie server-side padhi jaati hai
//     (`apps/video-editor/src/app/api/session/route.ts` iska kaam karta hai).
//     Ye ek appahi tha jo token ko browser storage me daalti thi.
//
// Ab cookie server par padhi jaati hai. Token kabhi JS me nahi jaata, isliye
// localStorage me rakhne ki koi zaroorat nahi - aur `packages/auth` ab sach me
// use nahi ho raha, to use DELETE kar diya gaya hai.
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const AUTH_INTERNAL =
  process.env.AUTH_INTERNAL_URL ?? 'http://auth-service:8085';

/**
 * The telemetry service, which OWNS the click ledger.
 *
 * `ui_click_events` moved out of `auth_service.click_events` - click data is not
 * an auth concern. This route was still calling
 * `/api/v1/auth/admin/clicks?limit=100`, which reads the pre-migration table,
 * so this app's Clickstream panel has been showing a DIFFERENT and much smaller
 * dataset from the superadmin ledger for the whole time the two have coexisted.
 * Two dashboards, same name, different tables.
 */
const ANALYTICS_INTERNAL =
  process.env.ANALYTICS_INTERNAL_URL ?? 'http://analytics-service:8091';

/** Shared secret for the telemetry service. Server-side only. */
const ANALYTICS_TOKEN = process.env.ANALYTICS_INTERNAL_TOKEN ?? '';

const SESSION_COOKIE = 'wideo11_session';

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
  } catch {
    // Upstream unreachable is NOT the caller's fault and must not look like
    // "no data" - that would hide a broken deployment behind an empty panel.
    //
    // No error message: `fetch`'s message embeds the internal hostname it could
    // not reach, and this response reaches the browser.
    return {
      status: 502,
      body: {
        error: 'upstream_unavailable',
        message: 'Cannot reach the authentication service.',
      },
    };
  }
}

/**
 * Read the ledger from the service that owns it.
 *
 * The caller's OWN verified token is forwarded as the internal token's carrier:
 * `analytics-service` authenticates peers with one shared secret, so the role
 * check has already happened by the time we get here (a non-superadmin was
 * refused by `awareness`). The shared secret never reaches the browser.
 */
async function forwardClicks(token: string | null, limit: number) {
  if (!token) {
    return { status: 401, body: { error: 'sign_in_required' } };
  }
  if (!ANALYTICS_TOKEN) {
    // Loud, not silent. Forwarding with no token to a service that would accept
    // one anyway is the failure this whole relay design exists to prevent.
    return {
      status: 500,
      body: {
        error: 'service_misconfigured',
        message: 'ANALYTICS_INTERNAL_TOKEN is not set on the analytics app.',
      },
    };
  }
  try {
    const res = await fetch(`${ANALYTICS_INTERNAL}/ui-clicks?limit=${limit}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': ANALYTICS_TOKEN,
      },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch {
    return {
      status: 502,
      body: {
        error: 'upstream_unavailable',
        message: 'Cannot reach the telemetry service.',
      },
    };
  }
}

export async function GET() {
  // The httpOnly cookie, read here on the server. The browser cannot read it -
  // which is the entire reason this works and the reason the token is not in
  // localStorage.
  const token = cookies().get(SESSION_COOKIE)?.value ?? null;

  const [overview, registrations, clicks] = await Promise.all([
    forward('/api/v1/auth/admin/awareness', token),
    forward('/api/v1/auth/admin/registrations?limit=100', token),
    // The REAL ledger, from the service that owns it. See `ANALYTICS_INTERNAL`.
    forwardClicks(token, 100),
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

  // `clicks`, not `events`. `analytics-service` returns
  // `{"clicks": [...], "total": N}`; the old auth-service table returned
  // `{"events": [...]}`. Reading the wrong key is what made this panel render
  // permanently empty while the table was full.
  const clickRows = Array.isArray(clicksBody.clicks) ? clicksBody.clicks : [];

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
      clicks: clickRows,
      clickTotal: num(clicksBody.total),
      // Surfaced so the UI can SAY which source it is reading. Two dashboards
      // showing different numbers for "clicks" is a support call; naming the
      // source on screen turns it into a glance.
      clickSource: 'analytics_service.ui_click_events',
      clicksUnavailable: clicks.status !== 200,
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
