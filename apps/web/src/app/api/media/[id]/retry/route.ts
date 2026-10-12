// /api/media/[id]/retry  -  re-queue the transcode for a FAILED asset.
//
// WHY THIS ROUTE EXISTS
// =============================================================================
//
// Before it, `failed` was a one-way door. The bytes were fine in the bucket, the
// transcode was cheap to redo, and `MarkTranscodeResult` refused any asset that
// was not mid-pipeline - so nothing in the product could move a row back out of
// `failed`. The creator's only route was re-uploading the whole file.
//
// The canonical case is a 4K upload that outran the transcoder's memory: the
// machine was at its limit, not the file. Retrying costs seconds; re-uploading
// 4 GB costs an evening.
//
// Same BFF contract as every other media route: the httpOnly session cookie is
// read here and turned into a bearer header, so the browser never holds a token
// and the asset id is not a credential.

import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}/retry`, 'POST');
}
