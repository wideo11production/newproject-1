// ============================================================================
// ANALYTICS STATS API - Get analytics statistics
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/analytics/stats', 'GET');
}
