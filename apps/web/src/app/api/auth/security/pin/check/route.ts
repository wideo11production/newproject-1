// /api/auth/security/pin/check  -  current PIN verify (READ-ONLY)
//
// Sirf CHECK karta hai, kuch change nahi. UI me two-step unlock ka backend:
//   1. user current PIN daale -> ye call
//   2. sahi hua to "new PIN" form reveal ho
//
// SECURITY: ye credential oracle hai, isliye ye `/security/*` bucket me hai
// (wahi rate limit jo real verify par lagta hai). Final rollover call par PIN
// DOBARA verify hota hai - beech me unlock ho jaye to bhi sahi hona zaroori hai.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/security/pin/check', 'POST');
}