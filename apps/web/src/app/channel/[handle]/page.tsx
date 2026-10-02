import ChannelPageClient from '@/components/channels/channel-page-client';

export const metadata = {
  title: 'Channel - Wideo11',
  description: 'Browse a channel on Wideo11',
};

/**
 * A public channel page, the way youtube.com/@handle works.
 *
 * A SERVER component for the shell, with one client child for the part that has
 * tabs and fetches.
 *
 * The handle is in the path, so the page is PUBLIC - the middleware lists
 * `/channel` as public, and both endpoints it reads are the public ones, which
 * answer the same 404 for a private channel as for a missing one.
 *
 * `params` is typed as a union because Next 14 hands over a plain object and
 * Next 15 a Promise. Handling both means this page does not break on the day the
 * upgrade lands, rather than being fixed in a hurry after.
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

  return (
    <div className="space-y-6">
      <ChannelPageClient handle={clean} />
    </div>
  );
}
