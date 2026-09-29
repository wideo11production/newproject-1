// /api/profile  -  creator profile (GET) + avatar update (PATCH)
//
// Same-origin proxy: token httpOnly cookie se server-side attach hota hai.
// GET  -> auth-service /profile/full  (avatar_url ke saath)
// PATCH-> auth-service /profile       (avatar set/clear)
//
// Hinglish: profile dekho, ya avatar badlo
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/profile/full', 'GET');
}

export async function PATCH(req: NextRequest) {
  return forwardAuth(req, '/profile', 'PATCH');
}