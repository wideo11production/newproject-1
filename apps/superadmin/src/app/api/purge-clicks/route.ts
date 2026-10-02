// Manual click-ledger purge.
//
// ~~Was: forward('/admin/clicks/purge') to auth-service.~~ The table now lives
// in analytics-service, so the purge has to go there - or it would silently
// report success while deleting nothing, which is the worst possible outcome for
// a destructive action.
//
// NOTE ON WHY THIS IS A BUTTON AND NOT A CRON ONLY: the retention job already
// sweeps every 6 hours (90-day window). This endpoint exists for the case where
// an operator needs the rows gone NOW - after a deletion request, say - rather
// than at the next sweep. It is a POST for that reason: a GET that deletes is
// something a crawler, a prefetcher or a browser restore could trigger.
//
// The service also re-checks that the caller's role is superadmin before doing
// anything, because this route performs a DELETE.
import { forwardTelemetry } from '@/lib/telemetry-proxy';

export async function POST(request: Request) {
  // The window is the service's configured retention, not something a caller
  // supplies. A caller-chosen cutoff is a foot-gun - "yesterday" would delete
  // everything older than a day, and the request would read like the gentlest
  // possible option.
  return forwardTelemetry('/ui-clicks/purge', request, 'POST');
}