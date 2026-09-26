// POST /api/auth/webauthn/login/begin
// Login ka pehla step: challenge + allowed credentials lena
// Hinglish: login ka pehla step - challenge mangwao

import { forwardToAuth } from '@/lib/webauthn-proxy';

export async function POST(request: Request) {
  return forwardToAuth('/api/v1/auth/webauthn/login/begin', request);
}
