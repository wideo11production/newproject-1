// /api/media/comments/[cid]/like  -  toggle the viewer's like
//
// A POST and not a PUT, because the endpoint TOGGLES: the same request likes an
// unliked comment and unlikes a liked one, which is what the control on screen
// does. A PUT would promise "set to this state" and then quietly do the opposite
// of what was asked half the time.
//
// The path is `/api/media/comments/[cid]` rather than nesting under the asset,
// because a like acts on a COMMENT and not on a clip - and an asset id in the path
// would be redundant with the comment's own.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { cid: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/comments/${encodeURIComponent(params.cid)}/like`, 'POST');
}
