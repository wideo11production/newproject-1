// ============================================================================
// BILLING WALLET API - Get wallet info
// ============================================================================
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/wallet', 'GET');
}

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/wallet/withdraw', 'POST');
}
