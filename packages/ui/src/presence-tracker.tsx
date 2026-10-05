'use client';

// Presence heartbeat: tells the server this browser is still here.
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS
// -----------------------------------------------------------------------------
//
// The superadmin dashboard showed, for every user, permanently:
//
//     Online Now            0
//     Total Sessions        0
//     Total Seconds Online  0
//     Distinct Devices      0
//
// while people were demonstrably signed in. The server side of presence - start,
// heartbeat, end - existed and was correct. What was missing was anything that
// CALLED it.
//
// This is that caller, and it is mounted in each app's layout beside
// `GlobalActivityTracker`, for the same reason that component lives in the layout:
// a feature that depends on being invoked has to be invoked from the one place
// every route passes through.
//
// -----------------------------------------------------------------------------
// WHAT IT SENDS, AND WHAT IT DELIBERATELY DOES NOT
//
// It sends exactly one thing: "I am still here". No user id, no email, no IP, no
// device identity from the client.
//
// Everything identifying comes from the server side of the request. An endpoint
// that accepted `user_id` in a body would make every number on the dashboard
// forgeable by anyone who can reach it - which is the same reasoning as
// `audit-handler.ts` taking `surface` from the server rather than the payload.
//
// The one exception is the `X-Fingerprint` header, which the platform auth flow
// already sends on every call. That is a browser-derived value, not a hardware
// identifier - see the note in `handler/presence.go` for why a MAC address is not
// reachable from a web page at all.
//
// -----------------------------------------------------------------------------
// WHY 60 SECONDS
// -----------------------------------------------------------------------------
//
// The server treats a row as online only if `last_seen_at` is inside
// `SessionIdleTimeoutMinutes` (30). At a 60s beat there are 29 missed beats of
// headroom before a user is shown as offline.
//
// A shorter interval would be more precise and would triple the write volume -
// every beat is a row update. A longer one would make the dashboard lag behind
// reality, and a "who is online" panel that is two minutes stale is the kind of
// number people stop trusting.
//
// -----------------------------------------------------------------------------
// WHY `visibilitychange` MATTERS MORE THAN THE TIMER
// -----------------------------------------------------------------------------
//
// Browsers throttle timers in a background tab to roughly once a minute, and some
// throttle harder. So on a background tab the interval alone drifts, and on return
// the panel can show somebody offline who is not.
//
// Which is exactly when the accuracy matters - somebody switched back to the tab
// and looked. So the beat is fired immediately on becoming visible, which makes
// the number correct at the moment it is read.

import { useEffect, useRef } from 'react';

const HEARTBEAT_MS = 60_000;

/**
 * Where presence lives: the APP's own origin, as a RELATIVE path.
 *
 * ---- WHY NOT `NEXT_PUBLIC_AUTH_API_URL` ----
 *
 * The first version built the URL from `NEXT_PUBLIC_AUTH_API_URL`, giving
 * `http://localhost:8085/api/v1/auth/presence`. That address is auth-service, and
 * the browser calling it directly fails for two independent reasons:
 *
 *   1. auth-service sends no CORS headers for these routes, so the request is
 *      blocked before it can be answered.
 *   2. the session credential is an httpOnly cookie scoped to this app's origin. A
 *      cross-origin `fetch` would not send it even with CORS enabled, because
 *      `credentials: 'include'` on a cross-origin request requires
 *      `Access-Control-Allow-Credentials` AND an explicit allow-origin per origin -
 *      which is a much wider CORS surface than this needs.
 *
 * The symptom was silent and total: every beat failed, no presence cookie was ever
 * set, and the dashboard's Online Now tile stayed at 0 while looking like a query
 * problem rather than a routing one. Found by asking the browser what it had
 * actually requested.
 *
 * So: a relative path. Each app has a three-line re-export of
 * `@wideo11/ui/presence-handler` at `/api/auth/presence/*`, which reads the cookie
 * server-side and relays. That is the same-origin path, and it is why those 24
 * routes exist.
 *
 * No configuration is involved, which also means there is nothing here that can be
 * set wrongly per app - the class of bug where a `NEXT_PUBLIC_*` is defined in the
 * wrong block and silently reads `undefined`.
 */
function presenceEndpoint(): string {
  return '/api/auth/presence';
}

/**
 * A stable per-browser device id.
 *
 * ---- WHY A RANDOM STORED ID AND NOT A "FINGERPRINT" ----
 *
 * The obvious implementation of "count the devices using this account" is to
 * fingerprint the browser - canvas, screen geometry, font list, hardware
 * concurrency - and hash it. That is what `X-Fingerprint` names in every auth call
 * in this codebase implies, and it is the wrong tool here, for three reasons:
 *
 *  1. IT IS NOT WHAT ANY CLIENT HERE SENDS. `apps/web/src/app/api/auth/login`
 *     carries the comment "Fingerprint nahi bhejte - auth-service use tabhi store
 *     karta hai". So `devices.fingerprint` is empty for every user, and
 *     `distinct_devices` would be permanently 0 - a panel that looks broken and is
 *     actually unanswered.
 *
 *  2. IT IS A TRACKING SURFACE. Fingerprinting identifies a browser across sites
 *     and survives cookie clearing. Deploying one is a privacy and consent
 *     decision, not an implementation detail, and it is not a decision to make
 *     quietly inside a presence component.
 *
 *  3. THE QUESTION DOES NOT NEED IT. "How many devices is this account using right
 *     now" is answered by a per-browser identifier, not by a hardware signature.
 *
 * So: a random UUID in `localStorage`. It identifies THIS browser's install for
 * THIS user. It is not derived from anything about the machine, it cannot be
 * correlated with anything else, and clearing it costs the user nothing - the next
 * visit mints a new one and the device count briefly counts two.
 *
 * That last property is the honest trade and it is the right way round: the failure
 * mode is an over-count, not an under-count, and an over-count is visible.
 *
 * localStorage can throw (private browsing, some corporate policies), so every
 * access is guarded. Without a device id the beats still work - only the distinct
 * count reads 0.
 */
const DEVICE_ID_KEY = 'wideo11.device-id';

function deviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    // `crypto.randomUUID` needs a secure context, which this does not always have -
    // an insecure origin, some embedded webviews. So there is a fallback.
    //
    // Typed as a loose record deliberately. Writing
    // `'randomUUID' in crypto ? crypto.randomUUID() : crypto.getRandomValues(...)`
    // narrows `crypto` to `never` in the false branch, because the type system has
    // already concluded the object cannot exist. `globalThis.crypto` with an
    // explicit shape sidesteps that without a cast to `any`.
    const webCrypto = globalThis.crypto as {
      randomUUID?: () => string;
      getRandomValues?: (a: Uint8Array) => Uint8Array;
    } | undefined;

    let minted: string | null = null;

    if (typeof webCrypto?.randomUUID === 'function') {
      minted = webCrypto.randomUUID();
    } else if (typeof webCrypto?.getRandomValues === 'function') {
      minted = Array.from(webCrypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }

    if (!minted) return null;

    window.localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    return null;
  }
}

export function PresenceTracker() {
  // Guards against a second beat while one is in flight. Without it, a slow
  // network plus a `visibilitychange` produces overlapping requests, and the
  // server's `duration_seconds` accumulation counts the overlap - inflating
  // "seconds online" by however long the requests took.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Resolved once per mount and reused, so the server sees one stable value for
    // the life of the tab rather than a fresh id per beat.
    const device = deviceId();
    const headers: Record<string, string> = {
      // The relay forwards these. They are a LABEL, never an authorisation input -
      // see the note in `handler/presence.go` on why the client never names its own
      // user, which is the property that matters and the one this preserves.
      'X-Device-Id': device ?? '',
      'X-Device-Name': 'browser',
      'X-Platform': typeof navigator !== 'undefined' ? navigator.platform : '',
    };

    const endpoint = presenceEndpoint();
    if (!endpoint) return;

    /**
     * One POST, with every header and option in one place.
     *
     * The first version spelled the options out at each of the four call sites, and
     * a search-and-replace attached the device headers to two of them - the two
     * with `keepalive` - and missed the two inside `beat`. Nothing failed. The
     * server simply recorded an empty device on half the requests, so
     * `distinct_devices` was half of what it should be, and there was no error to
     * chase.
     *
     * Four call sites with four spellings of the same options is four chances to
     * differ. One helper is the fix, and the reason is not tidiness - it is that a
     * partially-applied edit is invisible by construction.
     */
    const post = (path: string, opts?: { keepalive?: boolean }) =>
      fetch(`${endpoint}${path}`, {
        method: 'POST',
        headers,
        credentials: 'include',
        cache: 'no-store',
        keepalive: opts?.keepalive,
      });

    const beat = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await post('/heartbeat');

        // 428 and 404 both mean "you have no usable presence row". The fix is the
        // same for both - start one, then beat - so they are handled together
        // rather than logged as errors. 409 means the row was closed deliberately
        // (a sign-out on another tab) and is also recovered from, because a user
        // who is demonstrably using the app is present by definition.
        if (res.status === 428 || res.status === 404 || res.status === 409) {
          const started = await post('/start');
          if (!started.ok) return;

          const again = await post('/heartbeat');
          if (!again.ok) return;
        }
      } catch {
        // A failed heartbeat is not worth surfacing. Presence is telemetry: the
        // worst outcome of a dropped beat is that somebody appears briefly
        // offline, and a red banner about it trains people to ignore the panel
        // that actually matters. The next beat retries.
      } finally {
        inFlight.current = false;
      }
    };

    // Open a presence row on load. keepalive because a page being unloaded is
    // precisely when this request is most likely to be cut, and an open row that
    // never closes is a user shown online forever.
    const start = () => {
      post('/start', { keepalive: true }).catch(() => {
        // Same reasoning as the heartbeat: telemetry failing is not an error the
        // user can act on.
      });
    };

    start();

    const timer = setInterval(() => void beat(), HEARTBEAT_MS);

    const onVisible = () => {
      if (!document.hidden && !cancelled) void beat();
    };
    document.addEventListener('visibilitychange', onVisible);

    // ---- Close the presence row when the page goes away ----
    //
    // `pagehide` rather than `beforeunload`: `beforeunload` is not fired on a
    // mobile page discard and on some back/forward navigations, which are exactly
    // the cases that leave a row stuck open. `pagehide` covers all of them.
    //
    // `visibilitychange` to `hidden` is ALSO fired, and deliberately NOT treated as
    // an end: switching tabs is not leaving, and ending there would report almost
    // every user offline within seconds of them opening a second tab.
    const onPageHide = () => {
      post('/end', { keepalive: true }).catch(() => {
        // If this fails the row ages out on last_seen_at anyway, which is what
        // the idle window is for. This is a courtesy, not the mechanism.
      });
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Renders nothing. This is a side-effect component; it exists to be MOUNTED.
  return null;
}
