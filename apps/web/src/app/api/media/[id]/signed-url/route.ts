// /api/media/[id]/signed-url  -  a short-lived presigned GET for one object
// inside a media asset, so the owner can actually WATCH what they uploaded.
//
// The `video` bucket is private BY DESIGN (SYSTEM-PLAN R6: video is paid and
// tiered). That is correct, and it is also why a finished upload used to be
// invisible - a plain `http://minio/video/...` URL returns `AccessDenied` for
// everyone, including the uploader.
//
// Ownership is verified in auth-service (the token's user id is matched against
// the asset's owner), which has to happen there because MinIO has no idea who
// owns an object. This route forwards the caller's own session, so a signed URL
// can only ever be issued to the asset's owner.
//
// The returned URL is short-lived and carries a MinIO signature in its query
// string. It is never logged, never stored, and never returned from a listing.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  const path = new URL(req.url).searchParams.get('path') ?? '';
  if (!path) {
    return Response.json(
      { error: 'missing_path', message: 'path is required.' },
      { status: 400 }
    );
  }
  return forwardAuth(
    req,
    `/media/${encodeURIComponent(params.id)}/signed-url?path=${encodeURIComponent(path)}`,
    'GET'
  );
}
