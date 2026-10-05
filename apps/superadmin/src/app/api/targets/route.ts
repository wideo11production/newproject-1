// Top clicked controls - relayed to analytics-service.
//
// `GET /ui-clicks/targets` has been implemented, registered, aggregated and
// bounded in `analytics-service` since the ledger moved there - with ZERO
// callers. This route is the missing caller.
//
// Same relay as `api/clicks`: it checks the caller's ROLE before attaching the
// internal token. `lib/telemetry-proxy.ts` has the reasoning; in short, the
// browser must never hold a service credential, so the role is checked here and
// only the internal token is forwarded upstream.
import { forwardTelemetry } from '@/lib/telemetry-proxy';

export async function GET(request: Request) {
  return forwardTelemetry('/ui-clicks/targets', request);
}