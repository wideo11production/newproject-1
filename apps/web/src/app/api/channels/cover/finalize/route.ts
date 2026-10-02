// /api/channels/cover/finalize  -  step 3 of the cover upload (during creation)
//
// Server-side verification + returns public URL. No channel ID required.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/channels/cover/finalize', 'POST');
}