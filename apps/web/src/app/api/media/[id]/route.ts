// /api/media/[id]  -  one asset, owner-scoped.
//
// DELETE is deliberately here, on the plain asset path, rather than on a
// `/delete` sub-route. The auth-service route is `DELETE /media/:id`, and a
// second BFF path for the same operation would be a second thing to keep in sync
// with it.
//
// The service refuses anything that is not `failed`, and that is intentional: an
// in-flight asset is being written to by its own transcode, and deleting that row
// out from under the pipeline is how a callback resurrects a video the creator
// already removed.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}`, 'GET');
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}`, 'DELETE');
}
