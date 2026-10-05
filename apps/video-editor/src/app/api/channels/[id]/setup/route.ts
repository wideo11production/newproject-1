import { relayChannelSetup } from '../../../../lib/engine/channels-relay';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** One channel's branding setup — logo URL, brand hue, and the rest. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return relayChannelSetup(id, 'GET');
}

/** Update the logo URL. Nothing else on a channel is editable from the editor. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return relayChannelSetup(id, 'PATCH', request);
}