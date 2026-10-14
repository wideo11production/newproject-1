// /api/auth/me/fix-permissions - self-healing for missing creator role
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/me/fix-permissions', 'POST');
}