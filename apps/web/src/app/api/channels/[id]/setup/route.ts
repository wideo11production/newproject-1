// /api/channels/[id]/setup  -  read the step-2 state of one channel
//
// Returns the channel's current step-2 answers PLUS the brand palette and the
// byte limit for a logo.
//
// The palette comes from the server rather than being hardcoded here, because the
// set of colours a creator can choose is a product decision with a legibility
// guarantee behind it (every offered hue passes contrast against both themes).
// A client-side copy would be free to grow a colour nobody reviewed.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/channels/${encodeURIComponent(params.id)}/setup`, 'GET');
}

// PATCH, not POST.
//
// Step 2 saves as the creator moves between sections, so a PARTIAL update is the
// normal case rather than an exception - which is exactly why every field in
// `UpdateChannelSetupRequest` is a pointer. `POST` would mean "this is the whole
// object", and a form that saves one section at a time would then have to send
// everything every time, clobbering whatever another tab changed.
//
// The body is forwarded verbatim. Validating here would mean a second copy of
// every rule in `internal/model/channel_setup.go`, and two copies of validation is
// how a client ends up told a 120-character tagline is fine and then getting a 400
// for it.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return forwardAuth(req, `/channels/${encodeURIComponent(params.id)}/setup`, 'PATCH');
}
