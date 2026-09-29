// GET /api/auth/security/questions/available
// Security questions ki available list (user 3 choose karta hai).
//
// Hinglish: saare available questions laao
import { forwardSecurity } from '@/lib/security-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardSecurity(req, '/security/questions/available', 'GET');
}