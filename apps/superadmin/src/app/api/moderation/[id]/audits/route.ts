// /api/moderation/:id/audits - the full decision history for one asset.
//
// The reviewer's second question after "what am I looking at" is "what did the
// engine say, and has anyone already looked". `media_assets` carries only the
// CURRENT verdict, so this reads the audit table - which is the reason that table
// exists separately from the columns.
//
// Gated on `audit.view`, a weaker permission than the resolve route's
// `moderation.review`: somebody triaging an incident needs to read the history,
// and somebody publishing refused content needs a stronger grant.

import { forward } from '@/lib/proxy';

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: Ctx
) {
  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return Response.json(
      { error: 'invalid_asset_id', message: 'An asset id is a UUID.' },
      { status: 400 }
    );
  }
  return forward(`/api/v1/auth/moderation/${id}/audits`, request, 'GET');
}
