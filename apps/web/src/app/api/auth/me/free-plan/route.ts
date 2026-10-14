// /api/auth/me/free-plan - activate the free creator plan
//
// Grants the caller the `trial` plan if they hold no live entitlement. Called
// from the dashboard's Channel tab before a channel is created, so an account
// from before trials were automatic ends up with a real plan row rather than
// with nothing at all.
//
// Idempotent: a caller already on a plan is told so and left alone.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return forwardAuth(req, '/me/free-plan', 'POST');
}
