// /api/media/list  -  the caller's own media assets, filtered by tab/kind.
//
// Proxies to auth-service's /media endpoint with query parameters for filtering.
// Owner-scoped on the server (the user id is read from the session token).
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') || 'all';
  const kind = searchParams.get('kind');

  // Build query string for auth-service
  const params = new URLSearchParams();
  params.set('limit', '50');
  
  if (kind && kind !== 'all') {
    params.set('kind', kind);
  } else if (tab !== 'all') {
    // Map tab to kind for server-side filtering
    if (tab === 'reels') params.set('kind', 'reel');
    if (tab === 'shorts' || tab === 'long') params.set('kind', 'video');
    if (tab === 'audio') params.set('kind', 'audio');
  }

  const qs = params.toString();
  return forwardAuth(req, `/media?${qs}`, 'GET');
}