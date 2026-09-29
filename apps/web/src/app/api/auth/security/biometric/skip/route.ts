// POST /api/auth/security/biometric/skip  -  user declines biometric
//
// User ke EXPLICIT "biometric nahi chahiye" decision ko backend me persist
// karta hai (migration 010 ka `biometric_opted_out`).
//
// YE "mark as registered" NAHI HAI - wo bug tha:
// capable device par skip karne par koi credential create nahi hota tha, to
// backend ka `setup_complete` false rehta tha, jabki frontend optimistically
// true set kar deta tha. Middleware wapas security-setup bhej deta tha, aur
// user dashboard <-> gate ke beech LOOP me fas jata tha.
//
// Is endpoint se decision persist hota hai, aur completion rule usko
// "satisfied" maanta hai - loop khatam.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/security/biometric/skip', 'POST');
}
