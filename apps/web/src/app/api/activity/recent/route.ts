// ============================================================================
// ACTIVITY RECENT API - Get recent user activity
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/activity/recent', 'GET');
}
