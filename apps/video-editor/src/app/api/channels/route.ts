import { relayChannelList } from '../../lib/engine/channels-relay';

export const dynamic = 'force-dynamic';

/**
 * The channels this signed-in user owns.
 *
 * Relayed rather than proxied to the web app: see `channels-relay.ts` for why the
 * editor talks to `auth-service` itself. There is no middleware in this app, so no
 * matcher registration is needed for this path to exist.
 */
export async function GET() {
  return relayChannelList();
}