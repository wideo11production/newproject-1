// GET /api/admin/storage - MinIO cluster health, relayed.
//
// Thin adapter; the guard, allowlist and error policy all live in
// `lib/internal-proxy.ts`. The console itself is NOT relayable - see the
// UPSTREAMS comment there for what "storage console" honestly means here.
import { relayToInternal } from '@/lib/internal-proxy';

export async function GET(request: Request) {
  const qs = new URL(request.url).searchParams;
  const path = qs.get('probe') === 'ready' ? '/minio/health/ready' : '/minio/health/live';
  return relayToInternal('storage', path, request);
}
