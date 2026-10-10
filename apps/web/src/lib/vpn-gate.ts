// Anti-fraud gate: VPN / proxy / datacenter / TOR detection, env-gated.
//
// =============================================================================
// HONEST SCOPE, READ THIS FIRST
// =============================================================================
//
// "Military grade unhackable" does not exist, and anyone who says their VPN
// detection is unhackable is selling something. What this file actually is:
//
//   1. A hard gate that is ON IN PRODUCTION (`ALLOW_VPN=false`) and OFF IN
//      DEVELOPMENT (`ALLOW_VPN=true`), controlled by one env var, exactly as
//      specified. Dev keeps multi-country pricing testing working.
//   2. Two DETECTION SOURCES, both advisory:
//        - a configured provider (`VPN_DETECTION_URL`) - the real answer;
//      - the public TOR exit list - free, and only covers TOR.
//   3. FAIL-OPEN on every error path. A provider outage or an unreachable list
//      must not take the whole product down for every honest user; the log line
//      carries what happened. Fail-CLOSED here would turn a payment-provider
//      blip into a total outage - a worse failure than the fraud it prevents.
//
// The client IP comes from Cloudflare headers ONLY when `TRUST_PROXY_HEADERS`
// is on. Without a trusted proxy in front, `cf-connecting-ip` is a string the
// caller typed, and iplist.ts building a fraud control on caller-supplied data
// is decoration. This file does not pretend otherwise.

import { NextResponse } from 'next/server';

/** One hour, in ms. The TOR list changes slowly; re-fetching per request is silly. */
const LIST_TTL_MS = 60 * 60 * 1000;

let torCache: { fetchedAt: number; ips: Set<string> } | null = null;
let torInflight: Promise<Set<string>> | null = null;

/**
 * Fetch the TOR bulk exit list. Fail-open: an unreachable list yields an EMPTY
 * set, which blocks nobody - see the fail-open note above.
 */
async function torExits(): Promise<Set<string>> {
  const url = process.env.TOR_EXIT_LIST_URL ?? 'https://check.torproject.org/torbulkexitlist';
  const now = Date.now();
  if (torCache && now - torCache.fetchedAt < LIST_TTL_MS) return torCache.ips;
  if (torInflight) return torInflight;

  torInflight = (async () => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const text = await res.text();
      const ips = new Set(
        text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /^\d{1,3}(\.\d{1,3}){3}$/.test(l)),
      );
      torCache = { fetchedAt: Date.now(), ips };
      return ips;
    } catch {
      // Logged, not thrown. A fraud control that can fail the REQUEST pipeline
      // is an availability bug wearing a security costume.
      console.warn('[vpn-gate] TOR exit list unreachable - TOR check skipped this hour');
      return torCache?.ips ?? new Set();
    } finally {
      torInflight = null;
    }
  })();

  return torInflight;
}

/**
 * The caller's IP, from the ONLY source that can be trusted.
 *
 * Order: Cloudflare's header when a trusted proxy is configured, then the
 * runtime's own view of the socket. `x-forwarded-for` is deliberately absent
 * without `TRUST_PROXY_HEADERS`: it is caller-controlled by default.
 */
function clientIp(request: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const cf = request.headers.get('cf-connecting-ip');
    if (cf) return cf.trim();
    const xff = request.headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim();
  }
  return '';
}

/**
 * The middleware. Returns a Response ONLY when the request is refused; `null`
 * means "carry on", which keeps the wiring at the call site a single `if`.
 */
export async function vpnGate(request: Request): Promise<Response | null> {
  // DEV DEFAULT: allowed. `ALLOW_VPN=false` is the production switch, and the
  // check being OFF by default means a misconfigured deploy cannot lock out
  // every user on day one - it locks out nobody until someone turns it on.
  if (process.env.ALLOW_VPN !== 'false') return null;

  const ip = clientIp(request);
  if (!ip) return null; // Unknown origin (local dev, direct compose access): nothing to check.

  // ---- TOR ----
  try {
    if ((await torExits()).has(ip)) return refuse('tor');
  } catch {
    /* fail-open, see torExits */
  }

  // ---- Configured intelligence provider (optional) ----
  const provider = process.env.VPN_DETECTION_URL;
  if (provider) {
    try {
      const res = await fetch(`${provider}?ip=${encodeURIComponent(ip)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const verdict = await res.json().catch(() => ({}));
        // Provider-agnostic: any of the common flag spellings blocks.
        const flagged =
          verdict?.vpn === true ||
          verdict?.proxy === true ||
          verdict?.hosting === true ||
          verdict?.is_vpn === true ||
          verdict?.is_datacenter === true;
        if (flagged) return refuse('provider');
      }
    } catch {
      // Fail-open, logged. The provider is an enhancement, not a dependency.
      console.warn('[vpn-gate] detection provider unreachable - provider check skipped');
    }
  }

  return null;
}

/** The refusal, with the EXACT message the product spec asks for. */
function refuse(reason: string): NextResponse {
  console.warn(`[vpn-gate] refused request (reason=${reason})`);
  return NextResponse.json(
    {
      error: 'Access denied',
      message: 'VPN/Proxy connections are not allowed in Production.',
    },
    { status: 403 },
  );
}
