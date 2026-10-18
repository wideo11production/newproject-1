// ============================================================================
// BILLING SUBSCRIPTION API - Get user subscription
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/subscriptions/user/me', 'GET');
}

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/subscriptions/pending', 'POST');
}
