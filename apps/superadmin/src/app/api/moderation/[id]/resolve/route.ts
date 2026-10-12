// /api/moderation/:id/resolve - a human decides whether a held upload publishes.
//
// =============================================================================
// WHY THE METHOD IS RATHER THAN A VERDICT
// =============================================================================
//
// The body is `{ approve, note }`. Two options, not a three-value enum, and the
// constraint is not a taste preference: a human resolving a borderline item has
// exactly two questions to answer - "may this be seen" and "why did you decide
// that". An enum with `reject` would invite writing "reject" on an asset the
// service refuses to refuse, because `ResolveModeration` only accepts
// `pending_review` and `flagged`.
//
// =============================================================================
// WHY A REJECTED ASSET CANNOT BE RELEASED HERE
// =============================================================================
//
// It is enforced in the service (`IsModerationPending`), and the reason is the
// zero-tolerance promise in the T&C. If a reviewer could quietly publish a video a
// screener refused, the policy would be advisory - and a promise that says "unless
// somebody disagrees" is not a zero-tolerance policy.
//
// So a 409 from auth-service means exactly that, and this route passes it through
// verbatim: the reviewer HAS the permission, and this asset is not in a state they
// may decide. Mapping it to 403 would tell them the wrong thing.

import { forward } from '@/lib/proxy';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: Ctx
) {
  const { id } = await params;
  // Validated here so a malformed id never reaches auth-service as a path segment:
  // the relay would return a 404, which reads the same as "this asset is gone"
  // rather than "you asked about nothing".
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return Response.json(
      { error: 'invalid_asset_id', message: 'An asset id is a UUID.' },
      { status: 400 }
    );
  }
  return forward(`/api/v1/auth/moderation/${id}/resolve`, request, 'POST');
}
