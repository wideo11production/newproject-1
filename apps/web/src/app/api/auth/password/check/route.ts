// /api/auth/password/check  -  current password verify (READ-ONLY)
//
// Sirf CHECK karta hai, kuch change nahi. UI me two-step unlock ka backend:
//   1. user current password daale -> ye call
//   2. sahi hua to "new password" form reveal ho
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/password/check', 'POST');
}