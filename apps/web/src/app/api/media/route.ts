// /api/media  -  the caller's own media assets, newest first.
//
// Owner-scoped on the server (the user id is read from the session token, not
// from the query), so this can only ever return the caller's own rows.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  return forwardAuth(req, `/media${qs ? `?${qs}` : ''}`, 'GET');
}
