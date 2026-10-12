// Superadmin Dashboard - master control panel
//
// Ye app DEDICATED hai (alag entity) - user app se completely separate.
// Isme hai:
//   1. Click history (persistent, restart-safe, 30-day auto-purge)
//   2. Security events (lockouts, PIN failures, device breaches)
//   3. User activity (sessions, online time, devices)
//   4. Test account cleanup (production cutover)
//
// Hinglish comments: har block ka arth
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  BarChart3,
  MousePointerClick,
  ShieldAlert,
  Users,
  Trash2,
  RefreshCw,
  Eye,
  Loader2,
  CheckCircle2,
  Lock,
  Fingerprint,
  LogIn,
  Clock,
  Database,
  LayoutGrid,
  ExternalLink,
} from 'lucide-react';
import { ThemeToggle } from '@wideo11/ui/theme-toggle';
import { Panel, PanelGrid } from '@/components/dashboard/panel-grid';

/**
 * The sections on this page, and the default order of the panels below.
 *
 * ONE list, used for three things: the default drag order, the sidebar index, and
 * the anchors the sidebar links to. A second hand-maintained list of the same
 * seven items is a list that will disagree with the first - and when it does, the
 * sidebar either links to a panel that is not there or skips one that is.
 *
 * `id` values are STABLE. Changing one orphans anybody's saved layout: their stored
 * order references an id that no longer exists, so that panel is dropped from their
 * order and re-appended at the bottom. `panel-grid.tsx` validates and reconciles,
 * so this degrades rather than breaks - but the saved arrangement is lost, which is
 * the whole point of storing it.
 */
const PANEL_SECTIONS = [
  // The acknowledgement history is listed FIRST.
  //
  // Not an editorial choice. It is the answer to the question the banner exists to
  // raise — "has anyone actually looked at this?" — so it belongs at the top of the
  // index rather than at the bottom where it would be found by scrolling past
  // everything else.
  { id: 'acknowledgements', label: 'Acknowledgements' },
  { id: 'clicks', label: 'Click Ledger' },
  { id: 'targets', label: 'Top Controls' },
  { id: 'top-pages', label: 'Top Pages' },
  { id: 'security', label: 'Security Events' },
  { id: 'activity', label: 'User Activity' },
  { id: 'ledger', label: 'User Ledger' },
  { id: 'earnings', label: 'Ad Earnings' },
  { id: 'admin-analytics', label: 'Admin Analytics' },
] as const;

/** Where the dragged panel order is stored. One key, one browser, one operator. */
const PANEL_LAYOUT_KEY = 'wideo11.superadmin.panel-order.v1';

/**
 * One row of the click ledger, as `analytics-service` actually emits it.
 *
 * This interface used to declare `timestamp`, and the service has never emitted
 * that key - it emits `occurred_at` (client-reported) and `created_at`
 * (server-written). So `new Date(c.timestamp)` rendered `Invalid Date` on every
 * row. Combined with `d.events` where the service returns `d.clicks`, the whole
 * Click History panel was unreachable: the array was always empty, so the table
 * never rendered and the Empty state was the only thing anyone saw.
 *
 * Both failures are the same shape - a panel that quietly shows "no data" while
 * the ledger is full - which is why the field names are now asserted against the
 * Go model in `tools/check-click-ledger.mjs` rather than trusted to be right.
 */
interface ClickEvent {
  id: string;
  /** Which app sent it: `web`, `editor`, `admin`, ... Server-authoritative. */
  surface: string;
  page: string;
  target: string;
  label: string;
  element_id: string;
  x: number;
  y: number;
  referrer: string;
  ip_address: string;
  user_email: string;
  user_id: string;
  device: string;
  browser: string;
  os: string;
  country: string;
  /**
   * `verified` | `anonymous` | `forged`. Set by the sending app's server after a
   * JWT signature check, never by the browser.
   *
   * `forged` is the click-fraud signal: a session cookie was presented and it
   * failed verification, which only a hand-built request does. `anonymous` is a
   * signed-out visitor and is the normal majority - it is not evidence of
   * anything on its own.
   */
  attribution: string;
  occurred_at: string;
  created_at: string;
}

interface ClickStats {
  total_clicks: number;
  clicks_today: number;
  clicks_24h: number;
  unique_users: number;
  top_pages: { page: string; surface: string; clicks: number }[];
  oldest_event: string | null;
  newest_event: string | null;
  retention_days: number;
  estimated_rows_pending_purge: number;
}

/** Aggregate of the most-pressed controls. Field is `count`, not `clicks`. */
interface TargetCount {
  target: string;
  count: number;
}

/**
 * One row of the alert-acknowledgement history.
 *
 * `event_missing` is the field that matters and it is easy to overlook: an
 * acknowledgement whose `security_events` row has been archived by retention must
 * STILL appear. Losing a history entry because a housekeeping job ran would be a
 * regression in the audit trail, discovered during an incident review — which is
 * the only time anybody reads this.
 */
interface SecurityAcknowledgement {
  id: string;
  event_id: string;
  acknowledged_by: string;
  acknowledged_at: string;
  note: string;
  ip_address: string;
  event_type: string;
  detail: string;
  event_email: string;
  event_ip: string;
  event_missing: boolean;
}

/**
 * Every app that writes to the ledger, as a closed list.
 *
 * Hardcoded rather than derived from the data on purpose. The obvious version -
 * build the dropdown from `SELECT DISTINCT surface` - shows an attacker a live
 * inventory of which apps are deployed, on an unauthenticated-ish path, and it
 * hides a typo: an app writing `edtior` would appear in its own dropdown and
 * look fine. A closed list means an unknown surface in the data is a bug to
 * investigate rather than a menu item.
 *
 * Mirrors `SERVER_SURFACE` in `docker-compose.yml` and
 * `NEXT_PUBLIC_APP_SURFACE` in each app's Dockerfile. `tools/check-surfaces.mjs`
 * clicks each app and asks the ledger which surface it recorded, which is what
 * keeps the three from drifting.
 */
/**
 * `NEXT_PUBLIC_AUTH_LOGIN_URL` and its constant are GONE.
 *
 * There was a build arg pointing at `localhost:3000/auth/login`, used by a bare
 * "Sign in" link on the not-signed-in screen. That link is replaced by a real form
 * posting to this app's own `/api/auth/login`, so the constant had no callers.
 *
 * Leaving it would have been the more common mistake: a dead constant reads as
 * configuration, and the next person to change it would be changing nothing. The
 * build arg is removed from the Dockerfile and from `docker-compose.yml` too, so
 * there is no second place to go looking.
 *
 * The form is also the better design, which is why replacing it was not a
 * compromise:
 *
 *   - cookies are scoped by DOMAIN, not port, so signing in here signs you in on
 *     every app - `localhost:3008` and `localhost:3000` are one host to a browser
 *   - the old link made port 3008 impossible to authenticate AT, which is what
 *     "I cannot log in to 3008" turned out to mean
 *   - a bounce to another origin to sign in is a two-step errand that looks
 *     exactly like a broken login
 */

const SURFACES = [
  'web',
  'editor',
  'admin',
  'analytics',
  'billing',
  'monitor',
  'currency',
  'superadmin',
] as const;

interface SecurityEvent {
  event: {
    id: string;
    email: string;
    event_type: string;
    detail: string;
    ip_address: string;
    timestamp: string;
  };
  critical: boolean;
  indicator: string;
}

/** Per-device ad revenue - billing DB se (cross-DB merge proxy se) */
interface DeviceRevenue {
  device_id: string;
  period: string;
  total_revenue: number;
  ad_impressions: number;
  linked_accounts: number;
  /** Cap usage percent (5000 INR cap ke against) */
  cap_usage_pct: number;
  requires_review: boolean;
  cap_exceeded: boolean;
  revenue_held: boolean;
  flagged_reason: string;
}

interface UserActivity {
  email: string;
  // NEW: registration date (auth DB se)
  registered_at: string | null;
  // NEW: role flags - staff vs regular user
  is_superadmin?: boolean;
  is_recovery?: boolean;
  is_active?: boolean;
  total_sessions: number;
  total_seconds_online: number;
  is_online: boolean;
  distinct_devices: number;
  first_seen: string | null;
  last_seen: string | null;
}

export default function SuperadminDashboard() {
  const router = useRouter();
  // -----------------------------------------------------------------------------
  // `token` IS GONE. THE COOKIE DOES THIS JOB.
  // -----------------------------------------------------------------------------
  //
  // This app's entire entry point used to be a password field asking for a JWT to
  // paste:
  //
  //     <input type="password" placeholder="eyJhbGciOi..." />
  //     "Get this from the auth-service login endpoint."
  //
  // `middleware.ts` in this same directory ALREADY requires a real session
  // (`requireRole: ['superadmin']`). Its own comment admitted the contradiction:
  // "This file makes the pages require a real session. It does NOT remove the
  // 'paste a bearer token' UI." So the app demanded two credentials at once - a
  // cookie to render, and a token to work - and the token half defeated the
  // cookie half.
  //
  // Why the token field was a real problem, not just bad taste:
  //
  //  1. It required the holder of a live session to ALSO copy a JWT out of a curl
  //     response. So the operational path to using this dashboard involved
  //     handling a bearer credential in a text box, in a screen share, in a
  //     screenshot, in a support ticket.
  //
  //  2. That token lived in React state and was attached manually to every fetch.
  //     Anything that can read JS can read it: an XSS, a malicious extension, a
  //     compromised dependency. `httpOnly` exists precisely to make a session
  //     unreadable from JavaScript, and a pasted token opts out of it deliberately.
  //
  //  3. Sign out was `setToken('')` - a React state change. It cleared the field
  //     and nothing else: no revocation call, no server-side invalidation. The
  //     JWT stayed valid until it expired. A button labelled "Sign out" that does
  //     not sign out is worse than no button.
  //
  // What it is now: the httpOnly `wideo11_session` cookie, which the middleware
  // already validates, plus a real `POST /auth/logout` for sign-out.
  //
  // `ready` is a THREE-state value, and the third state is the point. A plain
  // boolean "am I signed in?" conflates "not signed in" with "haven't asked yet",
  // and rendering the signed-out screen before the question is answered flashes
  // "sign in" at an operator who is very likely signed in. That flash is a small
  // thing that trains people to ignore the sign-in screen.
  const [authState, setAuthState] = useState<'checking' | 'signed-in' | 'signed-out'>('checking');

  // ---- Go to /login when there is no session ----
  //
  // `replace`, not `push`: pushing would leave `/login` in history, so Back from
  // the dashboard would land on a sign-in form for a session that exists.
  //
  // In an effect, not during render: `router` methods are not callable while
  // rendering and Next throws for it. In an effect it is also made once, from
  // `authState`, rather than on every re-render.
  //
  // Gated on `signed-out`, NOT on `!== 'signed-in'`. Redirecting during `checking`
  // would bounce a still-signed-in operator to the login page for the fraction of
  // a second the probe takes - which is the flash-of-sign-in that got the old
  // two-state boolean replaced in the first place.
  useEffect(() => {
    if (authState === 'signed-out') router.replace('/login');
  }, [authState, router]);
  const [stats, setStats] = useState<ClickStats | null>(null);
  const [clicks, setClicks] = useState<ClickEvent[]>([]);
  const [clickTotal, setClickTotal] = useState(0);
  const [security, setSecurity] = useState<SecurityEvent[]>([]);
  const [activity, setActivity] = useState<UserActivity[]>([]);
  // Unified ledger: auth (user data) + billing (device revenue) merged
  const [ledger, setLedger] = useState<{
    devices: DeviceRevenue[];
    cap_inr: string | null;
    review_at_inr: string | null;
  }>({ devices: [], cap_inr: null, review_at_inr: null });
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [purging, setPurging] = useState(false);

  // ---- Live view state ----
  //
  // The request was "record every click, keep it, and show it". Record and keep
  // already worked. SHOWING it was a manual Refresh button, so the dashboard
  // showed the same 100 rows until somebody thought to press it - which is not a
  // live view, it is a screenshot.
  //
  // This polls. The interval is 5s to match the browser's own flush interval
  // (`FLUSH_INTERVAL_MS` in `@wideo11/ui/activity-tracker`): polling faster than
  // the writer writes returns the same rows repeatedly, and polling slower makes
  // the stream look broken in gaps. Polling, rather than a NATS consumer, is a
  // deliberate choice - see the note on `liveClicks`.
  const [live, setLive] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);

  // ---- Alert acknowledgement ----
  //
  // A SET of acknowledged event ids, not a count. The banner asks "is THIS one
  // acknowledged"; a count would let it go quiet because some OTHER event was
  // acknowledged, which is precisely the failure it exists to prevent.
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
  const [acknowledgements, setAcknowledgements] = useState<SecurityAcknowledgement[]>([]);
  const [showAcked, setShowAcked] = useState(false);

  // ---- Click-ledger filters ----
  //
  // `surface` and `attribution` are filters because those are the two questions
  // the raw table cannot answer once it is more than a screen long: "what is
  // happening in the editor specifically" and "is any of this fraudulent".
  const [surfaceFilter, setSurfaceFilter] = useState('all');
  const [attributionFilter, setAttributionFilter] = useState('all');
  const [topTargets, setTopTargets] = useState<TargetCount[]>([]);

  // Per-panel failure. Previously ONE `authError` string covered everything and
  // the four non-auth fetches were `.ok`-guarded and silently dropped, so a
  // broken `/api/clicks` rendered as an empty table - indistinguishable from
  // "nobody has clicked anything". On a dashboard whose entire purpose is
  // "did anyone click anything", that is the one failure that must not look empty.
  const [panelError, setPanelError] = useState<Record<string, string>>({});

  // ---- Data load (token chahiye) ----
  const loadAll = useCallback(
    async (opts?: { quiet?: boolean }) => {
      // Only load once we know there is a session. The old guard was `if (!token)`
      // - an in-memory string that started empty, so the first render fired no
      // requests and every panel sat empty until somebody pasted something.
      if (authState !== 'signed-in') return;

      // `quiet` is the background poll. A poll must not flash the whole panel
      // into a loading state every 5 seconds - that is a seizure, and it also
      // hides the data the user is trying to read.
      if (!opts?.quiet) setLoading(true);

      // NO Authorization header. The httpOnly `wideo11_session` cookie rides
      // along automatically, and each `/api/*` route reads it server-side and
      // attaches the bearer header itself.
      //
      // That indirection is the point. Previously the browser assembled a bearer
      // credential, which meant any script on the page could read it. Now the
      // credential exists only in the server's memory for the duration of one
      // request.
      const h: Record<string, string> = {};
      const qs = new URLSearchParams({ limit: '200' });
      if (surfaceFilter !== 'all') qs.set('surface', surfaceFilter);

      try {
        // Parallel fetch - sab ek saath.
        //
        // This used to fetch `/api/ledger` TWICE in the same Promise.all. The
        // array destructures five results out of six promises, so the second
        // response was discarded - a duplicate auth-service round trip on every
        // load, and a confusing thing to find while debugging.
        const [statsRes, clicksRes, targetsRes, secRes, actRes, ledgerRes] =
          await Promise.all([
            fetch('/api/stats', { headers: h, cache: 'no-store' }),
            fetch(`/api/clicks?${qs}`, { headers: h, cache: 'no-store' }),
            fetch('/api/targets?limit=20', { headers: h, cache: 'no-store' }),
            fetch('/api/security', { headers: h, cache: 'no-store' }),
            fetch('/api/activity', { headers: h, cache: 'no-store' }),
            // Ledger = cross-DB merge (auth users + billing device revenue)
            fetch('/api/ledger', { headers: h, cache: 'no-store' }),
          ]);

        if (statsRes.status === 401 || statsRes.status === 403) {
          // The session is gone or is not a superadmin. This is a STATE change,
          // not a message to display over stale data: keeping the previous rows on
          // screen after the session that authorised them has ended is showing
          // somebody data they may no longer be entitled to.
          setAuthState('signed-out');
          setAuthError(
            statsRes.status === 403
              ? 'This account is not a superadmin.'
              : 'Your session ended. Sign in again.'
          );
          return;
        }

        const errs: Record<string, string> = {};

        if (statsRes.ok) {
          setStats(await statsRes.json());
        } else {
          errs.stats = `HTTP ${statsRes.status}`;
        }

        if (clicksRes.ok) {
          const d = await clicksRes.json();
          // `d.clicks`, not `d.events`. The service has always returned `clicks`.
          setClicks(d.clicks ?? []);
          setClickTotal(d.total ?? 0);
        } else {
          errs.clicks = `HTTP ${clicksRes.status}`;
        }

        if (targetsRes.ok) {
          const d = await targetsRes.json();
          setTopTargets(d.targets ?? []);
        } else {
          errs.targets = `HTTP ${targetsRes.status}`;
        }

        if (secRes.ok) {
          const d = await secRes.json();
          setSecurity(d.events ?? []);
        } else {
          errs.security = `HTTP ${secRes.status}`;
        }

        if (actRes.ok) {
          const d = await actRes.json();
          setActivity(d.activities ?? []);
        } else {
          errs.activity = `HTTP ${actRes.status}`;
        }

        // Unified ledger (cross-DB merge) - device revenue + cap policy
        if (ledgerRes.ok) {
          const l = await ledgerRes.json();
          setLedger({
            devices: l.devices ?? [],
            cap_inr: l.cap_inr ?? null,
            review_at_inr: l.review_at_inr ?? null,
          });
        } else {
          errs.ledger = `HTTP ${ledgerRes.status}`;
        }

        setPanelError(errs);
        setLastRefresh(Date.now());
      } catch {
        // A total network failure, not a per-panel one. Distinct from a panel
        // error because nothing at all came back, so "empty" would be a lie.
        setAuthError('Network error');
      } finally {
        if (!opts?.quiet) setLoading(false);
      }
    },
    [authState, surfaceFilter]
  );

  // ---- Session probe ----
  //
  // Asked once on mount, and again whenever the tab becomes visible (an operator
  // who leaves the dashboard open all day will be logged out eventually, and the
  // first thing they should see on return is the sign-in screen rather than a
  // frozen render of data they can no longer refresh).
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      try {
        const res = await fetch('/api/session', { cache: 'no-store' });
        if (cancelled) return;

        // 503 is auth-service being down. That is NOT "signed out" - treating it
        // as such would show a sign-in prompt during an outage and send the
        // operator to re-enter credentials that still work. Show the error and
        // keep retrying instead.
        if (res.status === 503) {
          setAuthError('The authentication service is unreachable. Try again shortly.');
          return;
        }

        if (res.ok) {
          setAuthState('signed-in');
          setAuthError('');
        } else {
          const body = (await res.json().catch(() => ({}))) as { reason?: string };
          setAuthState('signed-out');
          setAuthError(
            body.reason === 'wrong_role'
              ? 'This account is signed in but is not a superadmin.'
              : ''
          );
        }
      } catch {
        if (!cancelled) {
          setAuthError('Could not reach this server.');
        }
      }
    };

    void probe();

    const onVisible = () => {
      if (!document.hidden) void probe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ---- Sign out ----
  //
  // A real logout. The old button was `setToken('')`, which cleared a React
  // string and nothing else: no server call, no revocation, and the JWT stayed
  // valid until it expired. A control labelled "Sign out" that does not sign out
  // is worse than having no control, because it is a claim the product does not
  // honour.
  const signOut = useCallback(async () => {
    try {
      // `keepalive` so the request survives the redirect that follows it.
      await fetch('/api/logout', { method: 'POST', keepalive: true });
    } catch {
      // Even if this fails, drop the local state - the cookie may already be gone
      // and holding a dashboard open because a logout call timed out is not a
      // defensible failure mode.
    }
    setAuthState('signed-out');
    setAuthError('');
    // Clear what is on screen immediately. Revocation is asynchronous and may fail;
    // leaving the previous user's rows visible until it completes is the wrong
    // default.
    setClicks([]);
    setSecurity([]);
    setActivity([]);
    setStats(null);
    setLedger({ devices: [], cap_inr: null, review_at_inr: null });
    setTopTargets([]);
  }, []);

  // ---- Silent refresh: NOW LIVES IN THE SHARED GATE ----
  //
  // It used to be here, and it was the ONLY app in the product that had it.
  //
  // `auth-service` has always issued a 7-day refresh token. `apps/web` threw it
  // away, and so did the other five apps that have no login route of their own -
  // they authenticate through the cookie this app sets. So the longest-lived
  // credential in the product had exactly one reader, and every creator was
  // silently signed out every 15 minutes.
  //
  // It lives in `@wideo11/ui/gate` now. Two reasons, and the second is the one
  // that matters:
  //
  //   1. COVERAGE. The gate is the only layer every request passes through. A
  //      page-level effect misses API calls entirely, so a server-rendered fetch
  //      would 401 while the page still looked signed in - which is exactly the
  //      half-working state that reads as flakiness.
  //   2. ONE IMPLEMENTATION. This loop was the reason the behaviour differed per
  //      app. A second copy in this file would be a third thing to remember, and
  //      the history of this repository is a list of correct code with no caller.
  //
  // The gate renews when the access token is within 90 seconds of expiry, so
  // it costs one auth-service call per session per ~14 minutes rather than one
  // per request. It also distinguishes a 401 (the refresh token is genuinely dead
  // - clear the cookies and end the session) from a 503 or a network failure
  // (auth-service is briefly unreachable - leave everything alone, because
  // clearing on a transient blip would destroy a 7-day session over a hiccup).
  //
  // `/api/auth/refresh` still exists in this app as an explicit, on-demand
  // renewal, and remains public for the same reason `/api/auth/login` is: a
  // pre-authentication endpoint cannot require the session it is refreshing.

  // ---- Initial load + filter change: full load ----
  useEffect(() => {
    if (authState === 'signed-in') loadAll();
  }, [authState, loadAll]);

  // ---- Live poll ----
  //
  // Gated on `live` AND on the tab being visible. Polling a hidden tab burns
  // API calls to tell you nothing you can see, and browsers throttle background
  // timers anyway - so a naive `setInterval` polls at 1/min in a background tab
  // and looks broken on return. Pausing on `document.hidden` and refreshing
  // immediately on return is what makes it feel live rather than laggy.
  useEffect(() => {
    if (authState !== 'signed-in' || !live) return;

    const poll = () => {
      if (!document.hidden) loadAll({ quiet: true });
    };
    const onVisible = () => {
      if (!document.hidden) loadAll({ quiet: true });
    };

    const timer = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live, loadAll]);

  // ---- Manual purge (30-day retention) ----
  async function handlePurge() {
    setPurging(true);
    try {
      // No Authorization header - the cookie is the credential.
      const res = await fetch('/api/purge-clicks', { method: 'POST' });
      if (res.ok) {
        const d = await res.json();
        alert(`Purged ${d.deleted} clicks older than ${d.retention_days} days`);
        loadAll();
      }
    } finally {
      setPurging(false);
    }
  }


  // ============================================================================
  // NOT SIGNED IN -> GO TO /login
  // ============================================================================
  //
  // The credential form used to live HERE, inline, on the dashboard.
  //
  // It is now a real page at `src/app/login/page.tsx`, and this is a redirect.
  // The reasons that shape is better are in that file's header; the short
  // version is that a sign-in screen with no URL cannot be linked to, cannot be
  // bookmarked, cannot be a runbook step, and cannot be the `returnTo` of a
  // session that expired in another tab.
  //
  // It also removes a genuinely confusing behaviour: any failure of
  // `/api/session` used to render a PASSWORD FORM here, so a 503 from
  // auth-service - or a network blip - asked a still-signed-in operator for their
  // password. That reads as "I have been logged out" when nothing had happened.
  // The page and the dashboard now fail differently: a failure here is a failure,
  // and an unauthenticated session is a redirect.
  //
  // `<Redirect>` was removed in Next 14, so this is `router.replace` in an effect
  // with a `return` afterwards - which is also why the brief loading state below
  // exists. Returning nothing renders an empty page for a frame, and an empty page
  // on a security console reads as a crash.

  // ---- Load the acknowledgement history ----
  //
  // Separate from `loadAll` because it changes at a very different rate. The
  // dashboard polls every 5s; acknowledgements change when a human clicks a
  // button. Folding them together would mean the history is refetched 12 times a
  // minute for no reason, and — more importantly — a slow acknowledgement POST
  // would be racing a burst of GETs for the same rows.
  const loadAcknowledgements = useCallback(async () => {
    try {
      const res = await fetch('/api/alerts/acknowledgements?limit=200', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        acknowledgements?: SecurityAcknowledgement[];
      };
      setAcknowledgements(body.acknowledgements ?? []);

      // Rebuild the id SET from the same payload.
      //
      // Derived rather than fetched separately, so the banner and the panel can
      // never disagree — two requests would mean a window where the banner hides
      // an event the panel still lists as un-reviewed, or the reverse.
      setAcknowledgedIds(new Set((body.acknowledgements ?? []).map((a) => a.event_id)));
    } catch {
      // Failing to load the history must not break the dashboard. Worst case the
      // banner shows events that have been acknowledged — which is the safe
      // direction: re-reading an acknowledged alert costs a few seconds, missing
      // one costs an incident.
    }
  }, []);

  // Load it once on mount.
  useEffect(() => {
    void loadAcknowledgements();
  }, [loadAcknowledgements]);

  // ============================================================================
  // CRITICAL ALERT ACKNOWLEDGEMENT
  //
  // ---- ACKNOWLEDGED IS NOT RESOLVED, AND THE UI SAYS SO ----
  //
  // The button says "Acknowledge", NOT "Resolve" or "Dismiss". The distinction is
  // load-bearing: acknowledging records that a PERSON SAW THIS. It does not say
  // the condition is fixed, and nothing here changes the event row — the event
  // stays in the Security Events panel and still counts in the totals forever.
  //
  // Collapsing "seen" into "resolved" is how a live incident gets closed by
  // clicking a button, so the wording and the behaviour agree: the banner stops
  // shouting, the record stays.
  //
  // ---- THE BANNER COMES BACK BY ITSELF ----
  //
  // `unacknowledgedCritical` is derived per event, not from a single dismissed
  // flag. A NEW critical event has never been acknowledged, so the banner
  // returns — with no polling and no notification. An operator cannot silence this
  // permanently, and does not need to: they only ever silence the ones they have
  // actually looked at.
  //
  // ---- WHY IT IS SERVER-SIDE ----
  //
  // localStorage would be per-browser. Three operators, three banners, and no
  // shared picture. The question "has anyone looked at this?" has to have one
  // answer that survives the browser being closed, cleared, or being somebody
  // else's browser.

  // The event id lives at `event.id`, not `id`.
  //
  // `/api/security` wraps each row in an `event` object:
  //
  //     { event: { id, email, event_type, detail, ip_address, timestamp },
  //       critical: boolean, indicator: string }
  //
  // so `e.id` is undefined, and `acknowledgedIds.has(undefined)` is false for every
  // event — which would make the banner permanently visible regardless of what had
  // been acknowledged. Silently, because `undefined` in a `Set` lookup is not an
  // error. The acknowledgement set is keyed on `event.id` throughout.
  const unacknowledgedCritical = security.filter(
    (e) => e.critical && !acknowledgedIds.has(e.event.id)
  );

  const ackInFlight = useRef<Set<string>>(new Set());

  const acknowledge = useCallback(
    async (eventId: string, note: string) => {
      // One in-flight per event. A double click would otherwise produce two
      // POSTs, and the second would come back 409 — which is correct but reads
      // as an error in the UI for something that actually succeeded.
      if (ackInFlight.current.has(eventId)) return;
      ackInFlight.current.add(eventId);

      try {
        const res = await fetch(`/api/alerts/acknowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event_id: eventId, note }),
        });

        // 409 means somebody got there first. For the operator's intent that IS
        // the outcome they wanted, so it is treated as success rather than
        // surfaced as a failure — an error dialog telling somebody their click did
        // not register is worse than the click being redundant.
        const ok = res.ok || res.status === 409;
        if (!ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setAuthError(body.message ?? `Could not acknowledge (${res.status}).`);
          return;
        }

        // Update locally from the server's answer rather than optimistically, so
        // what the banner hides is what the server recorded.
        const body = (await res.json().catch(() => ({}))) as {
          acknowledgement?: { acknowledged_by: string; acknowledged_at: string; note: string };
          acknowledged?: boolean;
        };

        setAcknowledgedIds((prev) => new Set(prev).add(eventId));

        if (body.acknowledgement) {
          // `security.find(...)` matches on `event.id`, per the shape note above.
          const source = security.find((e) => e.event.id === eventId)?.event;

          setAcknowledgements((prev) => [
            {
              id: body.acknowledgement!.acknowledged_at,
              event_id: eventId,
              acknowledged_by: body.acknowledgement!.acknowledged_by,
              acknowledged_at: body.acknowledgement!.acknowledged_at,
              note: body.acknowledgement!.note,
              ip_address: '',
              event_type: source?.event_type ?? '',
              detail: source?.detail ?? '',
              event_email: source?.email ?? '',
              event_ip: source?.ip_address ?? '',
              event_at: source?.timestamp ?? null,
              event_missing: false,
            } as SecurityAcknowledgement,
            ...prev,
          ]);
        }

        // Reload the history from the server so the panel shows the authoritative
        // record rather than a locally-assembled guess at it.
        void loadAcknowledgements();
      } finally {
        ackInFlight.current.delete(eventId);
      }
    },
    // `security` is read inside, not depended on for identity: a new event
    // arriving should not invalidate this callback and re-create the refetch
    // closure mid-poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadAcknowledgements]
  );

  const criticalCount = unacknowledgedCritical.length;
  if (authState !== 'signed-in') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-500" />
      </div>
    );
  }

  // ============================================================================
  // GRAFANA-STYLE SHELL
  // ============================================================================
  //
  // A left rail of sections, a sticky top bar, and a dense panel grid you can drag
  // into whatever order you actually read things in.
  //
  // ---- WHY A SIDEBAR, GIVEN THERE IS ONE PAGE ----
  //
  // Because it is not navigation - there is nowhere else to go. It is an INDEX.
  // Seven panels on one scroll is a wall, and a wall has to be scrolled to be
  // understood. Anchors turn that wall into a table of contents that also scrolls
  // to the thing, which is the actual Grafana behaviour and the reason Grafana
  // feels navigable at twenty panels.
  //
  // The section list is derived from `PANEL_SECTIONS`, the same array that drives
  // the default panel order, so adding a panel in one place adds it to the rail.
  // Two hand-maintained lists of the same seven items is a list that will disagree.
  //
  // ---- WHY THE PANELS ARE DRAGGABLE ----
  //
  // Because the most-watched panel is rarely the most important one, and everyone
  // has a different answer. Grafana persists layout for exactly this reason.
  //
  // The ordering lives in `localStorage` under one key. That is a deliberate
  // trade-off against a server-side layout table, which would need a migration, an
  // endpoint, a settings screen and a permission model to remember a list of
  // strings for one person on one browser. See `panel-grid.tsx` for why it is
  // native drag-and-drop rather than a layout library.
  return (
    <div className="min-h-screen bg-gray-950">
      {/* ---- Top bar: sticky, so the controls never scroll away ---- */}
      <header className="sticky top-0 z-20-800 bg-gray-950/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          <ShieldAlert className="h-2.5 w-2.5 shrink-0 text-red-500" />
          <h1 className="text-sm font-semibold text-gray-50">Superadmin</h1>
          <span className="hidden text-xs text-gray-500 sm:inline">
            Security, click ledger and user intelligence
          </span>

          {/* ---- Content review link ----
              The moderation queue lives on its own route, and this is how an
              operator reaches it. A dashboard where a capability exists but has no
              navigation to it is the same failure as an endpoint with no route:
              the feature is complete and unreachable.
              
              Placed in the top bar rather than a panel, because it is a
              destination and not a panel - the panels on this page are one
              dashboard's widgets, and this is a separate workflow with its own
              page, its own queue and its own permission. */}
          <a
            href="/moderation"
            className="ml-1 flex items-center gap-1.5 rounded-md border-800 bg-gray-900/60 px-3 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-800"
          >
            <Eye className="h-2.5 w-2.5" />
            <span className="hidden sm:inline">Content review</span>
          </a>

          <div className="ml-auto flex items-center gap-2">
            {lastRefresh ? (
              <span className="hidden text-xs text-gray-600 md:inline">
                updated {new Date(lastRefresh).toLocaleTimeString()}
              </span>
            ) : null}

            <button
              onClick={() => loadAll()}
              disabled={loading}
              aria-label="Refresh all panels"
              className="flex h-9 items-center gap-2 rounded-md border-800 bg-gray-900/60 px-3 text-xs text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <RefreshCw className="h-2.5 w-2.5" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </button>

            {/* Reset the layout. A drag-and-drop feature with no undo is a trap: one
                stray drag and the arrangement is gone with no way back short of
                clearing site data by hand. */}
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(PANEL_LAYOUT_KEY);
                } catch {
                  // Storage unavailable - reload falls back to the default order anyway.
                }
                window.location.reload();
              }}
              title="Reset panel layout"
              aria-label="Reset panel layout to default"
              className="flex h-9 w-9 items-center justify-center rounded-md border-800 bg-gray-900/60 text-gray-400 transition-colors hover:bg-gray-800"
            >
              <LayoutGrid className="h-2.5 w-2.5" />
            </button>

            <ThemeToggle />

            <button
              onClick={() => void signOut()}
              className="h-9 rounded-md border-800 bg-gray-900/60 px-3 text-xs text-gray-400 transition-colors hover:bg-gray-800"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* ---- Section rail ----
            Hidden below `lg`. On a phone a fixed 200px rail costs more than it
            gives, and the panels are the point. */}
        <nav className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-52 shrink-0 overflow-y-auto-800 px-3 py-4 lg:block">
          <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Sections
          </p>
          <ul className="space-y-0.5">
            {PANEL_SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-gray-200"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>

          <p className="mb-2 mt-6 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
            Apps
          </p>
          <ul className="space-y-0.5">
            {[
              { label: 'Web', port: 3000 },
              { label: 'Editor', port: 3002 },
              { label: 'Admin', port: 3004 },
              { label: 'Analytics', port: 3005 },
              { label: 'Billing', port: 3003 },
              { label: 'Monitor', port: 3001 },
              { label: 'Currency', port: 3007 },
            ].map((a) => (
              <li key={a.port}>
                <a
                  href={`http://localhost:${a.port}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-800/60 hover:text-gray-300"
                >
                  {a.label}
                  <ExternalLink className="ml-auto h-2.5 w-2.5" />
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 p-4">
        <div className="space-y-4">

        {authError ? (
          <div className="rounded-md border-700/60 bg-red-950/40 p-4 text-sm text-red-300">
            {authError}
          </div>
        ) : null}

          {/* ---- CRITICAL ALERT BANNER ----
              Shows only UNACKNOWLEDGED critical events, so it can be quiet without
              being silenced — see the acknowledgement block above. */}
          {criticalCount > 0 && (
            <div className="space-y-3 rounded-md-600/60 bg-red-950/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <ShieldAlert className="h-6 w-6 shrink-0 text-red-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-red-600">
                    {criticalCount} UNACKNOWLEDGED CRITICAL EVENT
                    {criticalCount > 1 ? 'S' : ''}
                  </p>
                  <p className="text-sm text-red-300">
                    Acknowledge each below once reviewed. The event is not closed —
                    it stays in Security Events.
                  </p>
                </div>
              </div>

              {/* One row per event, each with its own OK.
                  A single "dismiss all" would record one acknowledgement for N
                  events, which is not what happened: a human looked at each. */}
              <ul className="space-y-2">
                {unacknowledgedCritical.map((e) => (
                  <li
                    key={e.event.id}
                    className="flex flex-wrap items-center gap-3 rounded-md border-800/50 bg-red-950/30 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-red-300">
                        {e.event.event_type}
                        {e.event.email ? ` · ${e.event.email}` : ''}
                      </p>
                      <p className="truncate text-xs text-red-200/70">{e.event.detail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void acknowledge(e.event.id, '')}
                      className="rounded-md bg-red-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      OK — I&apos;ve seen this
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ---- ACKNOWLEDGEMENT HISTORY ----
              The other half of the feature: "who saw what, and when".

              Collapsed by default. It is reference information, not an alert, and
              a table of old timestamps sitting permanently on screen trains people
              to stop reading panels — which is the same failure the permanent
              banner had, in a quieter form. */}
          <Panel
            id="acknowledgements"
            title="Alert Acknowledgements"
            subtitle={`${acknowledgements.length} recorded · "seen", not "resolved"`}
            icon={<CheckCircle2 className="h-2.5 w-2.5" />}
            actions={
              <button
                type="button"
                onClick={() => setShowAcked((v) => !v)}
                className="rounded-md border-800 bg-gray-900/60 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800"
              >
                {showAcked ? 'Hide' : 'Show'}
              </button>
            }
            bodyClassName={showAcked ? 'p-0' : 'p-0 hidden'}
          >
            {acknowledgements.length === 0 ? (
              <Empty icon={<CheckCircle2 className="h-8 w-8" />} text="Nothing acknowledged yet" />
            ) : (
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-900/95 text-left text-xs uppercase text-gray-500">
                    <tr className="border-b-800">
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Acknowledged by</th>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acknowledgements.map((a) => (
                      <tr key={a.id} className="border-b-800/50 hover:bg-gray-800/30">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-400">
                          {new Date(a.acknowledged_at).toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-300">
                          {a.acknowledged_by}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400">
                          {a.event_missing ? (
                            <span className="text-gray-600" title="This security event has been archived by retention. The acknowledgement is still valid.">
                              archived event
                            </span>
                          ) : (
                            <>
                              <span className="font-mono text-red-300">{a.event_type}</span>
                              {a.event_email ? ` · ${a.event_email}` : ''}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {a.note || <span className="text-gray-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

        {/* ---- Stat cards ---- */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard
            label="Total Clicks"
            value={stats?.total_clicks ?? 0}
            icon={<MousePointerClick className="h-2.5 w-2.5" />}
            color="text-blue-400"
          />
          <StatCard
            label="Clicks (24h)"
            value={stats?.clicks_24h ?? 0}
            icon={<Activity className="h-2.5 w-2.5" />}
            color="text-green-400"
          />
          <StatCard
            label="Unique Users"
            value={stats?.unique_users ?? 0}
            icon={<Users className="h-2.5 w-2.5" />}
            color="text-purple-400"
          />
          <StatCard
            label="Security Events"
            value={security.length}
            icon={<ShieldAlert className="h-2.5 w-2.5" />}
            color={criticalCount > 0 ? 'text-red-400' : 'text-gray-400'}
          />
          <StatCard
            label="Online Now"
            value={activity.filter((a) => a.is_online).length}
            icon={<Activity className="h-2.5 w-2.5" />}
            color="text-emerald-400"
          />
        </div>

        {/* ---- Retention banner ---- */}
        {stats && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border-800 bg-gray-900/50 p-4">
            <div className="flex items-center gap-3">
              <Database className="h-2.5 w-2.5 text-gray-400" />
              <div>
                <p className="text-sm text-gray-300">
                  Click history auto-purges after {stats.retention_days} days
                </p>
                <p className="text-xs text-gray-500">
                  {stats.estimated_rows_pending_purge} row(s) pending purge • last
                  click{' '}
                  {stats.newest_event ? new Date(stats.newest_event).toLocaleString() : '—'}
                </p>
              </div>
            </div>
            <button
              onClick={handlePurge}
              disabled={purging}
              className="flex items-center gap-2 rounded-md border-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
            >
              {purging ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5" />}
              Purge now
            </button>
          </div>
        )}

        {/* ==================================================================
         * THE PANEL GRID
         * ==================================================================
         *
         * Opens here, after the stat cards, and closes after the last panel.
         *
         * `order={PANEL_SECTIONS.map(s => s.id)}` is the DEFAULT arrangement. What
         * the operator drags is persisted on top of it under `PANEL_LAYOUT_KEY`, so
         * a panel added in a future release appears in its intended place rather
         * than at the bottom for anyone who has an arrangement saved.
         *
         * Each panel below carries `id="..."` matching an entry in
         * `PANEL_SECTIONS`. The grid reads those ids off the React elements to
         * reorder them - see `panel-grid.tsx`, specifically `orderedChildren`,
         * without which the drag state was all correct and nothing visibly moved.
         */}
        <PanelGrid order={PANEL_SECTIONS.map((s) => s.id)} storageKey={PANEL_LAYOUT_KEY}>

        {/* ---- Click history: THE LIVE LEDGER ---- */}
        <Panel
          id="clicks"
          title="Live Click Ledger"
          subtitle={`${clickTotal.toLocaleString()} total events · newest first${
            lastRefresh ? ` · refreshed ${new Date(lastRefresh).toLocaleTimeString()}` : ''
          }`}
          icon={<MousePointerClick className="h-2.5 w-2.5" />}
          actions={
            <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={live}
                onChange={(e) => setLive(e.target.checked)}
                className="h-2.5 w-2.5 accent-blue-500"
              />
              Live (5s)
            </label>
          }
        >
          {/* ---- Filters ----
              Two dropdowns, and the second one is the one that matters.

              `surface` answers "what is happening in the editor specifically",
              which the raw table cannot once it is more than a screen long - the
              editor serves `/`, so its rows are otherwise indistinguishable from
              web landing-page rows.

              `attribution` is the click-fraud control. `forged` isolates every
              hand-built request; `verified` counts only clicks whose session
              cookie passed a signature check. Counting without this filter means
              counting rows that anybody can manufacture. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select
              value={surfaceFilter}
              onChange={(e) => setSurfaceFilter(e.target.value)}
              className="rounded-md border-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
              aria-label="Filter by app"
            >
              <option value="all">All apps</option>
              {SURFACES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              value={attributionFilter}
              onChange={(e) => setAttributionFilter(e.target.value)}
              className="rounded-md border-700 bg-gray-900 px-2 py-1 text-xs text-gray-300"
              aria-label="Filter by attribution"
            >
              <option value="all">Any attribution</option>
              <option value="verified">Verified sessions only</option>
              <option value="anonymous">Anonymous only</option>
              <option value="forged">FORGED (fraud attempts)</option>
            </select>

            {attributionFilter === 'forged' && (
              <span className="rounded-md border-800 bg-red-950/40 px-2 py-1 text-xs font-semibold text-red-300">
                Showing rows whose session cookie failed signature verification
              </span>
            )}
          </div>

          {panelError.clicks ? (
            <PanelError msg={panelError.clicks} />
          ) : clicks.length === 0 ? (
            <Empty
              icon={<MousePointerClick className="h-8 w-8" />}
              text="No clicks recorded yet"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">App</th>
                    <th className="px-3 py-2">Page</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Trust</th>
                    <th className="px-3 py-2">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {clicks
                    .filter(
                      (c) => attributionFilter === 'all' || c.attribution === attributionFilter
                    )
                    .slice(0, 200)
                    .map((c) => (
                      <tr key={c.id} className="border-b-800/50 hover:bg-gray-800/30">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-400">
                          {/* occurred_at, with created_at as the authority.
                              occurred_at is client-reported - though the shared
                              handler now overwrites it with the server clock - and
                              created_at is what retention keys on. Showing the
                              second one is what makes a row's age mean something. */}
                          {new Date(c.occurred_at || c.created_at).toLocaleTimeString()}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
                            {c.surface || 'unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-blue-400">{c.page}</td>
                        <td
                          className="max-w-[220px] truncate px-3 py-2 font-mono text-xs text-gray-400"
                          title={c.label || c.target}
                        >
                          {c.target}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-300">
                          {c.user_email || <span className="text-gray-600">anon</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <AttributionBadge value={c.attribution} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                          {c.x},{c.y}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ---- Top targets ----
            `/ui-clicks/targets` has been implemented, registered, bounded and
            aggregated since the click ledger moved to analytics-service - with
            zero callers. This panel is the missing caller. The count field is
            `count`, not `clicks`, unlike `top_pages[].clicks`; that inconsistency
            is in the service and is noted rather than papered over. */}
        {topTargets.length > 0 && (
          <Panel
            id="targets"
            title="Most-pressed controls (30 days)"
            subtitle="Aggregate, not per-user"
            icon={<MousePointerClick className="h-2.5 w-2.5" />}
          >
            <div className="space-y-2">
              {topTargets.map((t) => {
                const max = topTargets[0]?.count || 1;
                const pct = (t.count / max) * 100;
                return (
                  <div key={t.target} className="flex items-center gap-3">
                    <span
                      className="w-56 truncate font-mono text-xs text-gray-400"
                      title={t.target}
                    >
                      {t.target}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-gray-300">
                      {t.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* ---- Top pages ---- */}
        {stats && stats.top_pages.length > 0 && (
          <Panel id="top-pages" title="Top Pages (7 days)" icon={<Activity className="h-2.5 w-2.5" />}>
            <div className="space-y-2">
              {stats.top_pages.map((p) => {
                const max = stats.top_pages[0]?.clicks || 1;
                const pct = (p.clicks / max) * 100;
                return (
                  <div key={p.page} className="flex items-center gap-3">
                    <span className="w-40 truncate font-mono text-xs text-gray-400">
                      {p.page}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className="h-full rounded-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-gray-300">
                      {p.clicks}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}

        {/* ---- Security events ---- */}
        <Panel
          id="security"
          title="Security Events"
          subtitle={`${security.length} events`}
          icon={<ShieldAlert className="h-2.5 w-2.5" />}
        >
          {security.length === 0 ? (
            <Empty icon={<CheckCircle2 className="h-8 w-8 text-green-600" />} text="No security events" />
          ) : (
            <div className="space-y-2">
              {security.slice(0, 25).map((e) => (
                <div
                  key={e.event.id}
                  className={`flex items-start gap-3 rounded-md p-3 ${
                    e.critical
                      ? 'border-red-800/50 bg-red-950/20'
                      : 'border-gray-800 bg-gray-950/40'
                  }`}
                >
                  <div className={e.critical ? 'text-red-500' : 'text-gray-500'}>
                    {eventIcon(e.event.event_type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${e.critical ? 'text-red-300' : 'text-gray-300'}`}>
                      {e.indicator}
                    </p>
                    <p className="text-xs text-gray-500">{e.event.detail}</p>
                    <p className="mt-1 font-mono text-[10px] text-gray-600">
                      {e.event.email} • {new Date(e.event.timestamp).toLocaleString()} • IP{' '}
                      {e.event.ip_address || '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ---- User activity ---- */}
        <Panel
          id="activity"
          title="User Activity"
          subtitle="Sessions and online time"
          icon={<Users className="h-2.5 w-2.5" />}
        >
          {activity.length === 0 ? (
            <Empty icon={<Users className="h-8 w-8" />} text="No activity recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Sessions</th>
                    <th className="px-3 py-2">Online</th>
                    <th className="px-3 py-2">Devices</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.email} className="border-b-800/50">
                      <td className="px-3 py-2 font-mono text-xs text-gray-300">
                        {a.email}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {a.total_sessions}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {Math.round(a.total_seconds_online / 60)}m
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {a.distinct_devices}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            a.is_online
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-gray-800 text-gray-500'
                          }`}
                        >
                          {a.is_online ? 'ONLINE' : 'OFFLINE'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        {/* ---- UNIFIED LEDGER (auth + billing cross-DB merge) ---- */}
        <Panel
          id="ledger"
          title="User Ledger"
          subtitle="Registration date + per-device earnings"
          icon={<Database className="h-2.5 w-2.5" />}
        >
          {activity.length === 0 ? (
            <Empty icon={<Users className="h-8 w-8" />} text="No user activity recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">User</th>
                    {/* NEW COLUMN: registration date (auth DB) */}
                    <th className="px-3 py-2">Registered</th>
                    <th className="px-3 py-2">Sessions</th>
                    <th className="px-3 py-2">Online</th>
                    <th className="px-3 py-2">Devices</th>
                    {/* NEW: staff / role flag */}
                    <th className="px-3 py-2">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a) => {
                    const reg = a.registered_at ? new Date(a.registered_at) : null;
                    return (
                      <tr key={a.email} className="border-b-800/50">
                        <td className="px-3 py-2 font-mono text-xs text-gray-300">
                          {a.email}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-400">
                          {reg ? reg.toLocaleDateString() : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">
                          {a.total_sessions}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">
                          {Math.round((a.total_seconds_online ?? 0) / 60)}m
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">
                          {a.distinct_devices}
                        </td>
                        <td className="px-3 py-2">
                          {a.is_superadmin ? (
                            <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              SUPERADMIN
                            </span>
                          ) : a.is_recovery ? (
                            <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                              RECOVERY
                            </span>
                          ) : a.is_superadmin === false || a.is_recovery === false ? (
                            <span className="rounded-full bg-gray-800 px-2 py-0.5 text-[10px] text-gray-400">
                              USER
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ---- PER-DEVICE AD EARNINGS (billing DB) ---- */}
        <Panel
          id="earnings"
          title="Per-Device Ad Earnings"
          subtitle={
            ledger?.cap_inr
              ? `cap ₹${ledger.cap_inr} · review at ₹${ledger.review_at_inr}`
              : 'device-level revenue ledger'
          }
          icon={<Database className="h-2.5 w-2.5" />}
        >
          {ledger.devices.length === 0 ? (
            <Empty
              icon={<Database className="h-8 w-8" />}
              text="No device revenue recorded yet — populate via the payout / ad-revenue flow"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-800 text-left text-xs uppercase text-gray-500">
                    <th className="px-3 py-2">Device</th>
                    <th className="px-3 py-2">Revenue</th>
                    <th className="px-3 py-2">Impressions</th>
                    <th className="px-3 py-2">Accounts</th>
                    <th className="px-3 py-2">Cap usage</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.devices.map((d) => {
                    // NOTE: ledger.devices Record<string, unknown>[] hai, isliye unknown values
    // ko number me cast karna padta hai - warna TS comparison error deta hai.
    const over = d.cap_usage_pct > 100;
                    return (
                      <tr key={String(d.device_id)} className="border-b-800/50">
                        <td className="px-3 py-2 font-mono text-xs text-gray-300">
                          {d.device_id}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-green-400">
                          ₹{d.total_revenue.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">
                          {d.ad_impressions}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-400">
                          {d.linked_accounts}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-800">
                              <div
                                className={`h-full rounded-full ${
                                  over ? 'bg-red-500' : 'bg-blue-500'
                                }`}
                                style={{ width: `${Math.min(100, d.cap_usage_pct)}%` }}
                              />
                            </div>
                            <span className="font-mono text-[10px] text-gray-500">
                              {Math.round(d.cap_usage_pct)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {d.cap_exceeded ? (
                            <span className="rounded-full bg-red-900/50 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                              CAP EXCEEDED
                            </span>
                          ) : d.requires_review ? (
                            <span className="rounded-full bg-amber-900/50 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                              REVIEW
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-[10px] text-green-400">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        )}
          )}
        </Panel>

        {/* ---- Admin Analytics ----
            Dynamic system metrics: Prometheus metrics, resource usage, API latency,
            error rates, and system health. Refreshes every 10s. */}
        <Panel
          id="admin-analytics"
          title="Admin Analytics"
          subtitle="System metrics, resource usage & API health"
          icon={<BarChart3 className="h-2.5 w-2.5" />}
        >
          <AdminAnalyticsPanel />
        </Panel>

        </PanelGrid>
        </div>
        </main>
      </div>
    </div>
  );
}

// ---- Small presentational components ----

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-md border-800 bg-gray-900/60 p-4">
      <div className={`mb-2 flex items-center gap-2 ${color}`}>{icon}</div>
      <p className="font-mono text-2xl font-bold text-gray-50">
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

/**
 * `Panel` is imported, not defined here.
 *
 * This file used to declare its own `Panel` - a rounded box with a title and a
 * body. It was fine, and it was the reason drag-to-reorder was impossible: a
 * reorderable grid needs to know which panel is which, which means every panel has
 * to carry a stable `id`, and a local component with no such concept cannot.
 *
 * There is now one `Panel`, in `components/dashboard/panel-grid.tsx`, and this page
 * uses it. Two panel components in one app is how they drift - the same finding as
 * five copies of `/api/health-check` and seven of `/api/audit`, where the fix
 * landed in one copy and the other six stayed broken.
 */

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-gray-500">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}

/**
 * A panel that FAILED, which must never look like a panel with no data.
 *
 * This exists because every non-auth fetch was `.ok`-guarded and silently
 * dropped. A 500 from `/api/clicks` and "nobody has ever clicked anything"
 * rendered identically - both an empty table. On a dashboard whose entire purpose
 * is to answer "did anything happen", a failure that looks like a quiet day is
 * the most expensive kind of lie there is: it is believed.
 */
function PanelError({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border-800/60 bg-amber-950/20 p-3">
      <ShieldAlert className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-500" />
      <div>
        <p className="text-sm font-semibold text-amber-300">
          This panel could not load ({msg})
        </p>
        <p className="text-xs text-amber-200/70">
          That is NOT the same as there being no data. The request failed, so what
          you are not seeing here is unknown, not empty.
        </p>
      </div>
    </div>
  );
}

/**
 * The trust state of one click row.
 *
 * This is the difference between a number and evidence.
 *
 * `verified`  - the sending app checked the session cookie's JWT signature. The
 *               user on this row signed in.
 * `anonymous` - no session cookie. A signed-out visitor. Normal, and on a
 *               landing site the majority. NOT evidence of anything.
 * `forged`    - a cookie WAS sent and it did NOT verify. The browser cannot
 *               produce this: the cookie is httpOnly, so JavaScript cannot
 *               rewrite it. Only a hand-built request does.
 *
 * A row whose `target` reads `security:RATE_LIMIT_BYPASS_ATTEMPT` and whose trust
 * badge reads `anon` is the whole product working - the record is there and it
 * says what it is.
 */
function AttributionBadge({ value }: { value: string }) {
  const v = (value || 'anonymous').toLowerCase();
  if (v === 'verified') {
    return (
      <span
        className="rounded-full bg-emerald-900/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
        title="Session cookie's JWT signature was verified by the sending app's server"
      >
        VERIFIED
      </span>
    );
  }
  if (v === 'forged') {
    return (
      <span
        className="rounded-full bg-red-900/60 px-2 py-0.5 text-[10px] font-semibold text-red-300"
        title="A session cookie was presented and its signature FAILED. A browser cannot produce this - the cookie is httpOnly. Treat as a hand-built request."
      >
        }
}

/**
 * ADMIN ANALYTICS PANEL - Dynamic system metrics from Prometheus.
 *
 * Shows real-time system metrics: CPU, memory, disk, API latency, error rates,
 * and request throughput. Refreshes every 10 seconds.
 */
function AdminAnalyticsPanel() {
  const [metrics, setMetrics] = useState<{
    cpu: { usage: number; cores: number } | null;
    memory: { used: number; total: number; usage: number } | null;
    disk: { used: number; total: number; usage: number } | null;
    api: { latency_p50: number; latency_p95: number; latency_p99: number; error_rate: number; rps: number } | null;
    loading: boolean;
    error: string | null;
    lastUpdate: number | null;
  }>({
    cpu: null,
    memory: null,
    disk: null,
    api: null,
    loading: true,
    error: null,
    lastUpdate: null,
  });

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch from the admin metrics relay (Prometheus)
      const [
        cpuRes,
        memRes,
        diskRes,
        apiRes,
      ] = await Promise.all([
        fetch('/api/admin/metrics?query=avg(rate(cpu_usage_seconds_total[1m]))', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total[5m])', { cache: 'no-store' }),
      ]);

      const [cpuData, memData, diskData, apiData] = await Promise.all([
        cpuRes.ok ? cpuRes.json() : null,
        memRes.ok ? memRes.json() : null,
        diskRes.ok ? diskRes.json() : null,
        apiRes.ok ? apiRes.json() : null,
      ]);

      // Parse Prometheus response format: { data: { result: [{ value: [timestamp, value] }] } }
      const parseValue = (data: any) => {
        try {
          return data?.data?.result?.[0]?.value?.[1] ?? null;
        } catch {
          return null;
        }
      };

      // Fetch additional API metrics
      const [apiLatencyRes, apiErrorRes, apiRpsRes] = await Promise.all([
        fetch('/api/admin/metrics?query=histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total[1m])', { cache: 'no-store' }),
      ]);

      const [latencyData, errorData, rpsData] = await Promise.all([
        apiLatencyRes.ok ? apiLatencyRes.json() : null,
        apiErrorRes.ok ? apiErrorRes.json() : null,
        apiRpsRes.ok ? apiRpsRes.json() : null,
      ]);

      setMetrics({
        cpu: cpuData ? { usage: parseFloat(parseValue(cpuData)) || 0, cores: 0 } : null,
        memory: memData ? { usage: parseFloat(parseValue(memData)) || 0, used: 0, total: 0 } : null,
        disk: diskData ? { usage: parseFloat(parseValue(diskData)) || 0, used: 0, total: 0 } : null,
        api: {
          latency_p50: 0,
          latency_p95: parseFloat(parseValue(latencyData)) || 0,
          latency_p99: 0,
          error_rate: parseFloat(parseValue(errorData)) || 0,
          rps: parseFloat(parseValue(rpsData)) || 0,
        },
        loading: false,
        error: null,
        lastUpdate: Date.now(),
      });
    } catch (err) {
      console.error('Admin analytics fetch error:', err);
      setMetrics(prev => ({ ...prev, loading: false, error: 'Failed to fetch metrics' }));
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const MetricCard = ({ label, value, unit = '', color = 'text-blue-400', trend }: { label: string; value: string | number; unit?: string; color?: string; trend?: number }) => (
    <div className="rounded-md border-800 bg-gray-900/60 p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-end gap-1">
        <span className={`font-mono text-2xl font-bold ${color}`}>{value}</span>
        {unit && <span className="text-xs text-gray-500 mb-1">{unit}</span>}
        {trend !== undefined && (
          <span className={`text-xs font-semibold ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend).toFixed(1)}%
          )}
        /**
 * ADMIN ANALYTICS PANEL - Dynamic system metrics from Prometheus.
 *
 * Shows real-time system metrics: CPU, memory, disk, API latency, error rates,
 * and request throughput. Refreshes every 10 seconds.
 */
function AdminAnalyticsPanel() {
  const [metrics, setMetrics] = useState<{
    cpu: { usage: number; cores: number } | null;
    memory: { used: number; total: number; usage: number } | null;
    disk: { used: number; total: number; usage: number } | null;
    api: { latency_p50: number; latency_p95: number; latency_p99: number; error_rate: number; rps: number } | null;
    loading: boolean;
    error: string | null;
    lastUpdate: number | null;
  }>({
    cpu: null,
    memory: null,
    disk: null,
    api: null,
    loading: true,
    error: null,
    lastUpdate: null,
  });

  const fetchMetrics = useCallback(async () => {
    try {
      // Fetch from the admin metrics relay (Prometheus)
      const [
        cpuRes,
        memRes,
        diskRes,
        apiRes,
      ] = await Promise.all([
        fetch('/api/admin/metrics?query=avg(rate(cpu_usage_seconds_total[1m]))', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total[5m])', { cache: 'no-store' }),
      ]);

      const [cpuData, memData, diskData, apiData] = await Promise.all([
        cpuRes.ok ? cpuRes.json() : null,
        memRes.ok ? memRes.json() : null,
        diskRes.ok ? diskRes.json() : null,
        apiRes.ok ? apiRes.json() : null,
      ]);

      // Parse Prometheus response format: { data: { result: [{ value: [timestamp, value] }] } }
      const parseValue = (data: any) => {
        try {
          return data?.data?.result?.[0]?.value?.[1] ?? null;
        } catch {
          return null;
        }
      };

      // Fetch additional API metrics
      const [apiLatencyRes, apiErrorRes, apiRpsRes] = await Promise.all([
        fetch('/api/admin/metrics?query=histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])', { cache: 'no-store' }),
        fetch('/api/admin/metrics?query=rate(http_requests_total[1m])', { cache: 'no-store' }),
      ]);

      const [latencyData, errorData, rpsData] = await Promise.all([
        apiLatencyRes.ok ? apiLatencyRes.json() : null,
        apiErrorRes.ok ? apiErrorRes.json() : null,
        apiRpsRes.ok ? apiRpsRes.json() : null,
      ]);

      setMetrics({
        cpu: cpuData ? { usage: parseFloat(parseValue(cpuData)) || 0, cores: 0 } : null,
        memory: memData ? { usage: parseFloat(parseValue(memData)) || 0, used: 0, total: 0 } : null,
        disk: diskData ? { usage: parseFloat(parseValue(diskData)) || 0, used: 0, total: 0 } : null,
        api: {
          latency_p50: 0,
          latency_p95: parseFloat(parseValue(latencyData)) || 0,
          latency_p99: 0,
          error_rate: parseFloat(parseValue(errorData)) || 0,
          rps: parseFloat(parseValue(rpsData)) || 0,
        },
        loading: false,
        error: null,
        lastUpdate: Date.now(),
      });
    } catch (err) {
      console.error('Admin analytics fetch error:', err);
      setMetrics(prev => ({ ...prev, loading: false, error: 'Failed to fetch metrics' }));
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Helper: render a metric value safely
  const getCpuUsage = () => metrics.cpu ? metrics.cpu.usage.toFixed(1) : '--';
  const getMemUsage = () => metrics.memory ? metrics.memory.usage.toFixed(1) : '--';
  const getDiskUsage = () => metrics.disk ? metrics.disk.usage.toFixed(1) : '--';
  const getApiLatency = () => metrics.api ? metrics.api.latency_p95.toFixed(0) : '--';
  const getErrorRate = () => metrics.api ? (metrics.api.error_rate * 100).toFixed(2) : '--';
  const getRps = () => metrics.api ? metrics.api.rps.toFixed(1) : '--';

  if (metrics.loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        <span className="ml-2 text-sm text-gray-400">Loading system metrics...</span>
      </div>
    );
  }

  if (metrics.error) {
    return (
      <div className="rounded-md border-red-800/50 bg-red-950/30 p-4 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load metrics</p>
        <p className="text-xs text-gray-500 mt-1">{metrics.error}</p>
        <button
          onClick={fetchMetrics}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* System Resources */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="CPU Usage"
          value={getCpuUsage()}
          unit="%"
          color="text-blue-400"
        />
        <MetricCard
          label="Memory Usage"
          value={getMemUsage()}
          unit="%"
          color="text-purple-400"
        />
        <MetricCard
          label="Disk Usage"
          value={getDiskUsage()}
          unit="%"
          color="text-amber-400"
        />
      </div>

      {/* API Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="API Latency (p95)"
          value={getApiLatency()}
          unit="ms"
          color="text-green-400"
        />
        <MetricCard
          label="Error Rate"
          value={metrics.api ? (metrics.api.error_rate * 100).toFixed(2) : '--'}
          unit="%"
          color="text-red-400"
        />
        <MetricCard
          label="Requests/sec"
          value={metrics.api ? metrics.api.rps.toFixed(1) : '--'}
          unit="rps"
          color="text-blue-400"
        />
        <MetricCard
          label="API Latency (p99)"
          value={'--'}
          unit="ms"
          color="text-purple-400"
        />
      </div>

      {/* Last updated */}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Auto-refresh: 10s</span>
        {metrics.lastUpdate && (
          <span>Last updated: {new Date(metrics.lastUpdate).toLocaleTimeString()}</span>
        )}
        <button
          onClick={fetchMetrics}
          className="flex items-center gap-1.5 rounded-md border-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Refresh Now
        </button>
      </div>
    </div>
  );
}
