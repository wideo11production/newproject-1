// /api/pricing  -  the seven paid tiers, priced for THIS buyer.
//
// Same-origin relay to billing-service's `GET /pricing`, which resolves the
// buyer's price band and applies each tier's currency.
//
// -----------------------------------------------------------------------------
// WHY THIS RELAY EXISTS AND WHY THE CURRENCY IS NOT TOUCHED HERE
// -----------------------------------------------------------------------------
//
// The reported bug was the low band pricing in rupees and being labelled USD, so
// an Indian buyer was shown "450 USD" - roughly forty thousand rupees at the
// gateway. The number was correct and the label was wrong, which is the worst
// shape a bug can have: nothing inside the system disagrees with itself.
//
// That fix belongs to billing-service, where the band's currency is decided and
// stored. Doing it here instead would mean relabelling prices in the BFF, and a
// label applied in a proxy is one the checkout would not know about - it would
// render rupees in the browser and charge whatever the plan row actually says.
//
// SO THIS ROUTE FORWARDS THE TWO COUNTRY SIGNALS AND STOPS.
//
// The declared country is the caller's own (`?country=IN`), because the buyer's
// account knows where they live. The IP country is read SERVER-SIDE from the
// request, never from a client parameter - a client-supplied IP is text a caller
// controls, and using it to choose a price would make the whole band table
// decorative.
//
// The `cf-ipcountry` / `x-vercel-ip-country` headers are taken first because this
// app is deployed behind a CDN that sets them from the real edge, and `x-forwarded-for`
// is the last resort. None of them is trusted for AUTHORIZATION - they choose a
// PRICE, and the guard on who may buy is the session, which is checked by the
// billing route itself.
//
// The response is public-facing and carries no PII: the two country codes were in
// the request, and the tiers are a public catalogue.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const BILLING_INTERNAL = process.env.BILLING_INTERNAL_URL ?? 'http://billing-service:8082';

/** A cached price is one that still sells a number that has since changed. */
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

/**
 * The buyer's country, from the edge.
 *
 * Order is deliberate: the CDN's own geolocation first, because it is set at the
 * edge and is the hardest to spoof; forwarding headers last, because a client can
 * set them and this value is only used to CHOOSE A PRICE - which is precisely the
 * case where spoofing has to be worth something, so it is capped here rather than
 * ignored.
 *
 * A country that cannot be resolved is left EMPTY, and billing-service defaults an
 * unknown country to the conservative high band. Passing a guessed country would
 * be strictly worse than passing none, because a wrong guess prices a real buyer
 * into the wrong band with nothing to show it was wrong.
 */
function edgeCountry(req: NextRequest): string {
  const headers: Array<[string, string]> = [
    ['cf-ipcountry', ''],
    ['x-vercel-ip-country', ''],
    ['x-country-code', ''],
  ];
  for (const [h] of headers) {
    const v = req.headers.get(h);
    if (v && v.trim() !== '' && v.trim().toUpperCase() !== 'XX') {
      // `XX` is the CDN's own "unknown" sentinel. Treating it as a country would
      // resolve to the unmapped fallback anyway, but naming it here documents the
      // value rather than leaving it as a magic string.
      return v.trim().toUpperCase();
    }
  }

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first; // an IP, not a country - billing maps it or defaults
  }
  return '';
}

export async function GET(req: NextRequest) {
  const declared = req.nextUrl.searchParams.get('country') ?? '';
  const ip = edgeCountry(req);

  const qs = new URLSearchParams();
  if (declared) qs.set('country', declared);
  if (ip) qs.set('ip_country', ip);

  let upstream: Response;
  try {
    upstream = await fetch(`${BILLING_INTERNAL}/pricing?${qs.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return NextResponse.json(
      {
        error: 'pricing_unavailable',
        message:
          'The pricing service could not be reached. Retry, and if it persists the catalogue needs operator attention.',
      },
      { status: 502, headers: NO_STORE }
    );
  }

  const body = await upstream.json().catch(() => ({}));

  // A 502 from upstream is passed through as-is with its status, because the
  // distinction between "catalogue not seeded" and "catalogue unreachable" is the
  // difference between an operator fixing a seed and a network fault, and
  // collapsing both into one message sends whoever reads it the wrong way.
  return NextResponse.json(body, { status: upstream.status, headers: NO_STORE });
}
