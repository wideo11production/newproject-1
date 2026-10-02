// /api/channels/setup/pending  -  "which channel do I have to finish setting up?"
//
// THE GATE'S DATA SOURCE.
//
// The response is computed by auth-service from `channels.setup_step2_at`, never
// from anything the client sends. That is the whole point: a gate the client
// decides for itself is a gate a client can be talked out of, and step 2 is
// COMPULSORY.
//
// This route is a straight forward. It has no session logic of its own, and it
// must not grow any: the moment this file starts deciding whether the caller is
// allowed to see the answer, there are two implementations of the rule and they
// will eventually disagree.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/channels/setup/pending', 'GET');
}
