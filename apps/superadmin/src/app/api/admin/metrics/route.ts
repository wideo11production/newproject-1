// GET /api/admin/metrics?query=up - relayed Prometheus query.
//
// The route is a THIN adapter: every decision (who may call, which upstream,
// which paths) lives in `lib/internal-proxy.ts` so the three admin relays cannot
// drift apart. See that file for why the allowlist is the whole security model.
import { relayToInternal } from '@/lib/internal-proxy';

export async function GET(request: Request) {
  // Prometheus requires a `query` (or `match`) parameter; forward the rest of
  // the query verbatim so `query_range` with its step/range works unchanged.
  //
  // Which endpoint is chosen by the DATA, not by a flag: `match` means series,
  // `start`+`step` means query_range, anything else is instant query. A flag
  // param would have to be stripped before forwarding and is one more thing to
  // forget; the presence of the parameters Prometheus itself needs is not.
  const qs = new URL(request.url).searchParams;
  const path = qs.get('match') !== null
    ? '/api/v1/series'
    : qs.get('start') !== null && qs.get('step') !== null
      ? '/api/v1/query_range'
      : '/api/v1/query';
  return relayToInternal('metrics', path, request, `?${qs.toString()}`);
}
