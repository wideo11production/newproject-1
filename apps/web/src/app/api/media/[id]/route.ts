// /api/media/:id  -  owner-scoped media asset reads and mutations.
//
// Proxies to auth-service's media endpoints with the session token.
//
// WHY GET EXISTS HERE AT ALL
//
// It did not, for as long as the upload path was broken by it. The pipeline in
// `lib/media-upload.ts` finishes with `pollAssetStatus`, which polls
// `GET /api/media/:id` until the asset reaches `ready` or `failed`. With no GET
// exported on this route, Next.js answered 405 to every poll, the client read
// that as an unreadable status, and the upload surface showed
//
//     Could not read the upload status.
//
// The bytes had already gone to MinIO by then, and the asset existed and was
// transcoding — but the caller could never learn that, so every upload
// reported failure no matter what the backend did. The proxy was the missing
// link, not the pipeline.
//
// The response is owner-scoped server-side: auth-service reads the user id off
// the token, so this can only ever return the caller's own asset.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

// Plain `params`, not `Promise<{ id: string }>`. This is Next 14, where the
// dynamic-route context is handed to the handler synchronously; the awaited
// pair is Next 15. `await` on a plain object happens to work at runtime, which
// is why the wrong form built and served for as long as it did — but it is a
// type that says one thing and a runtime that does another, and every other
// dynamic route in this app uses this form.
type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}`, 'GET');
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/media/${encodeURIComponent(params.id)}`, 'DELETE');
}