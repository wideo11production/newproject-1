import BrowseClient from '@/components/channels/browse-client';

export const metadata = {
  title: 'Channels - Wideo11',
  description: 'Browse channels on Wideo11',
};

/**
 * The public browse page - a SERVER component, so the heading and copy render on
 * the server. Only the filter row and the grid are client.
 *
 * It is public, and that is deliberate. It reads `/api/public/channels`, which
 * does not forward the session cookie, and this page's own metadata says
 * "Browse channels on Wideo11". It was still behind the auth gate, so an
 * anonymous visitor got a 307 to the login form - a public API behind a private
 * page, which nobody can use for the thing it exists for. `middleware.ts` now
 * lists `/channels` as public.
 *
 * =============================================================================
 * THE HEADER, AS A GALLERY MASTHEAD
 * =============================================================================
 *
 * The old header was `<h1 className="text-3xl font-bold">Channels</h1>` above
 * `<p className="text-gray-400">Follow channels and creators</p>`.
 *
 * Two things wrong with it for this page. The size was a page title rather than a
 * masthead, so the gallery underneath looked like a section of a document instead
 * of the subject of the page. And the subtitle restated the action - "Follow
 * channels and creators" - which tells a visitor something they are already doing
 * by arriving, while telling them nothing about what is actually here.
 *
 * What replaced it: a large, tightly-tracked title, and one line that answers the
 * only question a visitor has, which is whether there is anything worth looking at.
 */
export default function ChannelsPage() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 pb-24 pt-12 sm:px-8 lg:px-12 lg:pt-16">
      {/*
        `max-w-[1440px]` and generous side padding.

        A gallery that runs the full width of a 2560px monitor puts cards so far
        apart that no two of them relate to each other - the eye cannot hold more
        than about four columns as one group, and past that it stops reading the
        page as a collection. Capping the measure is what keeps it a gallery at any
        size, which is why it is set here rather than in the grid: the page owns the
        container, the grid owns the columns.
      */}
      <header className="mb-10 max-w-2xl">
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-white/95 sm:text-5xl">
          Channels
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-white/40">
          Every public channel on Wideo11. Sorted by most recent.
        </p>
      </header>

      <BrowseClient />
    </div>
  );
}
