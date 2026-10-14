// /api/media/:id  -  owner-scoped media asset mutations.
// 
// Proxies to auth-service's media endpoints with the session token.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return forwardAuth(req, `/media/${id}`, 'DELETE');
}