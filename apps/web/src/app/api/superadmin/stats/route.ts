// ============================================================================
// SUPERADMIN STATS API - Get superadmin dashboard stats
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/superadmin/stats', 'GET');
}
