// /api/media/comments/[cid]  -  edit or delete one comment
//
// Both paths are on the COMMENT id, not the asset id, because both act on a
// comment: the edit needs only the comment, and the delete needs the comment plus
// the asset it belongs to - which the service resolves itself rather than trusting
// a caller-supplied asset id.
//
// That last point matters: `Delete` is authorised for the author AND for the clip
// owner, and the clip owner has to come from the asset's own row. A route that let
// the caller name the asset would let a caller point at an asset they own while
// acting on someone else's comment.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { cid: string } };

/** PATCH: edit the body. The link ban runs again - an edit is a new submission. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/comments/${encodeURIComponent(params.cid)}`, 'PATCH');
}

/** DELETE: soft-delete. Author or clip owner, and both are the service's call. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/comments/${encodeURIComponent(params.cid)}`, 'DELETE');
}
