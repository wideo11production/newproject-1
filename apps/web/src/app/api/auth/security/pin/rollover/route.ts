// /api/auth/security/pin/rollover  -  old PIN verify -> new PIN
//
// Server side security:
//   - purana PIN bcrypt se verify hota hai
//   - naya PIN purane jaisa nahi ho sakta
//   - saare DUSRE sessions + refresh tokens + expired verification tokens
//     hard-delete ho jaate hain
//   - CURRENT session valid rehta hai (warna user naya PIN use hi nahi kar paata)
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function PUT(req: NextRequest) {
  return forwardAuth(req, '/security/pin/rollover', 'PUT');
}