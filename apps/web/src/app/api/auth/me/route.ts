// /api/me  -  current user identity + role
//
// Role yahan se aata hai taki frontend superadmin-only UI HIDE kar sake.
// NOTE: ye sirf UI hint hai - real authorization middleware par hai
// (client-side hiding security NAHI hai).
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/me', 'GET');
}