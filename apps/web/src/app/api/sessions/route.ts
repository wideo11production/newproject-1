// /api/sessions  -  active devices (kis device par login hai)
//
// GET -> auth-service /sessions (non-revoked, non-expired, user-scoped)
//
// SECURITY: response me sirf metadata (IP, user agent, times) - token hashes
// KABHI expose nahi hote. Server query me user_id filter laga hai, to
// cross-user leak nahi.
//
// Hinglish: mere active devices dikhao
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/sessions', 'GET');
}