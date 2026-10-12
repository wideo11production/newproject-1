// /api/moderation/queue - the held-back uploads a human must decide.
//
// =============================================================================
// WHY THIS IS ITS OWN ROUTE AGAIN
// =============================================================================
//
// The review queue is the ONLY place in the product where a person decides what
// may be published. Everything else in the pipeline is automated and would be
// happy to either release or refuse without anyone looking - and the borderline
// band the screener declares on purpose depends entirely on this queue having a
// reader.
//
// Before it, `ModerationWorklist` and `ResolveModeration` had no route at all, so
// every flagged upload sat at `flagged` forever: invisible to the public, invisible
// to its creator, invisible to every dashboard. That is a worse state than
// refusing it, because a refusal at least tells the creator something happened.
//
// Same-origin relay to auth-service, exactly like every other superadmin route -
// the credential is relayed and auth-service applies the real permission check.

import { forward } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit') ?? '25';
  const offset = url.searchParams.get('offset') ?? '0';
  return forward(
    `/api/v1/auth/moderation/queue?limit=${limit}&offset=${offset}`,
    request,
    'GET'
  );
}
