// /api/media/[id]/publish  -  release an owner's asset to the video page
//
// A thin forward to auth-service, which owns the gate. This route exists so the
// session cookie never leaves the browser's origin and so a client cannot POST
// directly at the backend with someone else's token.
//
// The gate is not duplicated here. auth-service checks ownership, `ready` and
// `moderation == approved`, and refuses the request rather than overriding the
// verdict - a copy of that check on this side would be a second place for the rule
// to drift, and the side that drifts is the one a caller reaches first.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  // The confirmation dialogue the owner accepted lives in the UI, and its
  // acceptance is recorded there before this call is made. This endpoint takes
  // the confirmation as given and records the publication timestamp.
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}/publish`, 'POST');
}
