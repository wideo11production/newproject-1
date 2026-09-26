// POST /api/auth/webauthn/register/finish
// Registration ka doosra step: device ka attestation verify karna
// Hinglish: doosra step - signature verify karo

import { forwardToAuth } from '@/lib/webauthn-proxy';

export async function POST(request: Request) {
  return forwardToAuth('/api/v1/auth/webauthn/register/finish', request);
}
