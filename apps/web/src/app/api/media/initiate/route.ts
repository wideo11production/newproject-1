// /api/media/initiate  -  step 1 of a media (video/audio/reel) upload.
//
// Returns a presigned MinIO PUT URL plus the asset row the upload is filed
// against. The browser then uploads the bytes DIRECTLY to MinIO - the file never
// passes through Next.js or the Go service, so an 8 GB upload costs the app
// server nothing.
//
// The quota / entitlement check happens HERE, server-side, before a URL is
// minted: a user who is over their plan's allowance learns it before spending
// their upload time rather than after.
//
// `content_hash` is the browser-computed SHA-256 of the file. It enables
// re-upload dedup: the same file re-uploaded by the same user reuses the
// renditions already in the bucket instead of paying a second ffmpeg pass.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/media/initiate', 'POST');
}
