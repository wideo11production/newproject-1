// /api/auth/password  -  current password verify -> new password set
//
// Same security model as PIN rollover: old credential verify, phir saare
// DUSRE sessions/tokens purge. Current session bachata hai.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function PUT(req: NextRequest) {
  return forwardAuth(req, '/password', 'PUT');
}