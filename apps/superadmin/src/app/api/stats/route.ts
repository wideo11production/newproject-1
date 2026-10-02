// Click ledger summary for the Awareness grid header.
//
// ~~Was: forward('/admin/clicks/stats') to auth-service.~~ Now served by
// analytics-service, which owns the ledger. See `lib/telemetry-proxy.ts` for why
// this relay checks the caller's role rather than passing their token through.
import { forwardTelemetry } from '@/lib/telemetry-proxy';

export async function GET(request: Request) {
  return forwardTelemetry('/ui-clicks/stats', request);
}