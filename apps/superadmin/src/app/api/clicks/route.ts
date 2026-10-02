// Click ledger list - relayed to analytics-service.
//
// ~~Was: forward('/admin/clicks') to auth-service.~~
//
// The ledger moved out of `auth_service.click_events` into
// `analytics_service.ui_click_events`. Click data is not an auth concern - the
// table only ever ended up in auth-service because that was the only service
// with a database already wired up.
//
// This relay differs from `proxy.ts`'s `forward()` in one important way: it
// checks the caller's ROLE before attaching the internal token. See
// `lib/telemetry-proxy.ts` for why that is not optional.
import { forwardTelemetry } from '@/lib/telemetry-proxy';

export async function GET(request: Request) {
  return forwardTelemetry('/ui-clicks', request);
}