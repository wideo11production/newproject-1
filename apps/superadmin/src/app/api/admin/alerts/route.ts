// GET /api/admin/alerts - relayed Alertmanager alert list.
//
// Thin adapter; the guard, allowlist and error policy all live in
// `lib/internal-proxy.ts`. Filters (`active`, `silenced`, ...) pass through.
import { relayToInternal } from '@/lib/internal-proxy';

export async function GET(request: Request) {
  return relayToInternal('alerts', '/api/v2/alerts', request);
}
