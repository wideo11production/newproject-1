// /api/channels/[id]/cover/finalize  -  step 3 of the cover upload
//
// The server verifies the uploaded object with MAGIC BYTES (not the client's
// content-type claim), force-sets the stored content-type, and persists
// `cover_url` onto the channel.
//
// NOTE: unlike avatars, there is NO separate PATCH step for the parent. The
// finalize endpoint writes the URL itself, so the client is done after this
// one call.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(
    req,
    `/channels/${encodeURIComponent(params.id)}/cover/finalize`,
    'POST'
  );
}
