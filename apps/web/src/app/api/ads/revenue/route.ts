// ============================================================================
// AD REVENUE API - Get revenue statistics
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/ads/revenue/user-summary', 'GET');
}
