// /api/media/:id/status  -  one asset's pipeline state, on demand.
//
// The lighter of the two reads: auth-service answers with the status enum and
// the failure reason alone, without the full asset row (filename, sizes,
// renditions, moderation verdict) that `GET /api/media/:id` carries.
//
// Both exist because the two callers want different amounts. The upload
// progress panel asks one small question many times a minute while a file
// encodes, and the media library wants the whole row once.
//
// Owner-scoped server-side, like its sibling: the user id is read from the
// session token, so this cannot answer about anybody else's asset.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardAuth(req, `/media/${id}/status`, 'GET');
}
