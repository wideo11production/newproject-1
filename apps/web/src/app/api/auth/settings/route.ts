// /api/settings  -  user preferences SSOT
// GET   -> identity + preferences ek call me
// PATCH -> partial update
//
// Same-origin proxy: httpOnly session cookie server-side attach hota hai,
// isliye client ke paas token kabhi nahi hota.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/settings', 'GET');
}

export async function PATCH(req: NextRequest) {
  return forwardAuth(req, '/settings', 'PATCH');
}