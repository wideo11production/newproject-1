// /api/channels/[id]/cover/upload-url  -  step 1 of the cover upload
//
// Returns a presigned MinIO PUT URL. The browser then uploads the bytes
// DIRECTLY to MinIO - the file never passes through the Next.js server or the
// Go service.
//
// Same contract as the avatar uploader, so the client-side flow is identical.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(
    req,
    `/channels/${encodeURIComponent(params.id)}/cover/upload-url`,
    'POST'
  );
}
