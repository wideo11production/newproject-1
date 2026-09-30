// /api/channels/[id]  -  single channel: read (GET), edit (PATCH), delete (DELETE)
//
// ---- WHY THIS PROXY EXISTS ----
// The browser must never call the Go auth-service directly: it does not hold
// the session token (that lives in an httpOnly cookie) and it is on a
// different origin. `forwardAuth` reads the cookie and attaches the
// `Authorization: Bearer` header server-side.
//
// The upstream paths are:
//   GET    /api/v1/auth/channels/:id
//   PATCH  /api/v1/auth/channels/:id
//   DELETE /api/v1/auth/channels/:id
//
// ---- SECURITY: the proxy is NOT the authorization boundary ----
// Every channel route upstream is scoped `id = ? AND user_id = ?`, where
// user_id comes from the verified JWT and never from the body or the URL.
// So even a user who forges this request cannot read or mutate another
// user's channel - they get 404. That check lives in the Go service
// (internal/service/creator_channels.go); this file only forwards.
//
// Upstream status codes are passed through verbatim so the UI can tell a
// 404 (not yours / does not exist) from a 400 (invalid input).
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/channels/${encodeURIComponent(params.id)}`, 'GET');
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/channels/${encodeURIComponent(params.id)}`, 'PATCH');
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/channels/${encodeURIComponent(params.id)}`, 'DELETE');
}
