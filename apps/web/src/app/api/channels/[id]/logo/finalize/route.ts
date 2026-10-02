// /api/channels/[id]/logo/finalize  -  step 3 of the channel LOGO upload
//
// The server verifies the uploaded object with MAGIC BYTES, force-sets the stored
// content-type, saves `logo_url` onto the channel, and deletes the previous logo
// afterwards - not before, so a failed replacement leaves the creator with the
// logo they already had rather than with none.
//
// No separate PATCH afterwards, same as the cover: finalize writes the URL itself.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(
    req,
    `/channels/${encodeURIComponent(params.id)}/logo/finalize`,
    'POST'
  );
}
