// /api/channels/[id]/logo/upload-url  -  step 1 of the channel LOGO upload
//
// A logo is a SEPARATE asset from the cover: a square mark versus a wide banner,
// and it appears far more often (every card, every list row, every comment) at
// far smaller sizes. So it gets its own endpoints and its own byte budget rather
// than a `?kind=logo` parameter on the cover ones.
//
// A `kind` parameter would be one handler with two security profiles, and the
// branch nobody reads is the one that ends up with the wrong limit.
//
// The three steps and why the bytes never pass through Next.js are documented in
// `lib/channel-cover-upload.ts`.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(
    req,
    `/channels/${encodeURIComponent(params.id)}/logo/upload-url`,
    'POST'
  );
}
