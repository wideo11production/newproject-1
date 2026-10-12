import ChannelPageClient from '@/components/channels/channel-page-client';

export const metadata = {
  title: 'Channel - Wideo11',
  description: 'Browse a channel on Wideo11',
};

/**
 * A public channel page, the way youtube.com/@handle works.
 *
 * =============================================================================
 * STRUCTURE
 * =============================================================================
 *
 *   1. Sidebar       - media categories (All Media / Videos / Long Reels / ...)
 *   2. Upper header  - cover banner, avatar, Creator / Channel / Subscribers /
 *                      Joined, and the subscriber actions.
 *   3. Lower split   - nothing playing: the gallery spans 100%.
 *                      something playing: 2/5 gallery | 3/5 active player.
 *
 * The split is deliberately BELOW the header rather than swallowing it: the banner
 * and the channel identity are what the viewer came for, and a layout that pushed
 * them aside to show a video would answer a different question than the one they
 * asked.
 *
 * =============================================================================
 * NO PROVIDER HERE
 * =============================================================================
 *
 * The player's context provider lives in `ChannelSplit`, below the tabs. It used
 * to wrap this whole page as well, which meant TWO providers - the one by the
 * tabs and the one the client owned - and a card would call `play` on the inner
 * one while the page read `current` from the outer one. The player then never
 * appeared. One provider, read by exactly the components that need it.
 *
 * =============================================================================
 * WHY THIS IS A SERVER COMPONENT
 * =============================================================================
 *
 * The shell renders on the server, and only the part with tabs and fetches is a
 * client component. That keeps the header out of the client bundle entirely.
 */
export default async function ChannelPage({
  params,
}: {
  params: { handle: string } | Promise<{ handle: string }>;
}) {
  const { handle } = await params;

  // Tolerate both `@name` and `name`. People copy handles with the `@`, and
  // `youtube.com/@handle` is the shape people try first.
  const clean = decodeURIComponent(handle).replace(/^@/, '');

  return <ChannelPageClient handle={clean} />;
}
