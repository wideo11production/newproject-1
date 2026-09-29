// POST /api/auth/security/biometric/complete
// WebAuthn enrollment complete hone par backend ko batata hai, jisse
// `biometric_registered` flag true hota hai aur setup recompute hota hai.
//
// NOTE: empty body bhi allowed hai - credential optional hota hai (kuch
// devices default authenticator use karte hain).
//
// Hinglish: biometric enroll hone ke baad backend ko notify karo
import { forwardSecurity } from '@/lib/security-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardSecurity(req, '/security/biometric/complete', 'POST', {
    requireBody: true,
  });
}