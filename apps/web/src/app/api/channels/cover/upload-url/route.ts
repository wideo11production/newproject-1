// /api/channels/cover/upload-url  -  step 1 of the cover upload (during creation)
//
// Returns a presigned MinIO PUT URL. The browser then uploads the bytes
// DIRECTLY to MinIO - the file never passes through the Next.js server or the
// Go service. No channel ID required (channel doesn't exist yet).
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/channels/cover/upload-url', 'POST');
}