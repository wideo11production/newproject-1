// /api/media/quota  -  what this caller may still upload, per kind.
//
// Why this route exists at all: a trial user has zero upload allowance, and the
// only way to find that out used to be to pick a file, wait for the browser to
// hash it, POST the initiate, and read the refusal. The refusal named a
// capability (`your reel_assets allowance is used up`), which is meaningless to
// someone who just chose a video.
//
// The same server-side ledger the upload path enforces answers here, so this can
// never be more optimistic than the refusal. A failure on this route is
// non-fatal in the UI: the creator still gets the uploader and the server still
// refuses an over-quota upload authoritatively.
import { forwardAuth } from '@/lib/auth-proxy';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest) {
  return forwardAuth(req, '/media/quota', 'GET');
}
