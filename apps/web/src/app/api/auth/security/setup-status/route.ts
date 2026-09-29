// GET /api/auth/security/setup-status
// Mandatory security setup ka current status.
//
// Same-origin proxy: token httpOnly cookie se server-side attach hota hai,
// isliye client ko token ki zaroorat nahi. Isi endpoint ko middleware bhi
// call karta hai (server-to-server) taaki protected pages block ho sakein.
//
// Hinglish: security setup complete hua ya nahi - ye batata hai
import { forwardSecurity } from '@/lib/security-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardSecurity(req, '/security/setup-status', 'GET');
}