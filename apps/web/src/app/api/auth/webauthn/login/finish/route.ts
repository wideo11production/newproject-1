// POST /api/auth/webauthn/login/finish
// Login ka doosra step: device ka signature verify karna
// Ye password ki jagah use hota hai
// Hinglish: login ka doosra step - signature verify karo

import { forwardToAuth } from '@/lib/webauthn-proxy';

export async function POST(request: Request) {
  return forwardToAuth('/api/v1/auth/webauthn/login/finish', request);
}
