// POST /api/auth/webauthn/register/begin
// Registration ka pehla step: server se challenge + options lena
// Hinglish: pehla step - challenge mangwao

import { forwardToAuth } from '@/lib/webauthn-proxy';

export async function POST(request: Request) {
  return forwardToAuth('/api/v1/auth/webauthn/register/begin', request);
}
