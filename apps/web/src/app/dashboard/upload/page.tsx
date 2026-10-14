'use client';

/**
 * STUDIO UPLOAD PAGE - the single workspace page.
 *
 * =============================================================================
 * THE LAYOUT, LEFT TO RIGHT
 * =============================================================================
 *
 *   sidebar   - media categories (All Media / Videos / Long Reels / ...)
 *   main      - top nav
 *             - channel header card (Creator / Channel / Subscribers / Joined)
 *             - dashed dropzone
 *             - the split: Media Library  |  Active Player + info + comments
 *
 * The split is the point of the page: clicking a card fills the right half with a
 * player and the library stays where it is, so the viewer keeps their scroll
 * position and can click the next clip without dismissing anything.
 *
 * =============================================================================
 * WHY THE SIDEBAR FILTERS CLIENT-SIDE
 * =============================================================================
 *
 * Every category is a predicate over rows this page already has - see
 * `matchesCategory`. A round trip per click would put a spinner between the viewer
 * and the thing they clicked, to answer a question the data on screen can answer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StudioSidebar, matchesCategory, type MediaCategory } from '@/components/studio/StudioSidebar';
import { StudioHeader } from '@/components/studio/StudioHeader';
import {
  ChannelHeaderCard,
  formatSubscribers,
  formatJoined,
} from '@/components/studio/ChannelHeaderCard';
import { StudioMediaCard } from '@/components/studio/StudioMediaCard';
import { MediaLibraryPane } from '@/components/studio/MediaLibraryPane';
import { ActivePlayerPane } from '@/components/studio/ActivePlayerPane';
import type { ActivePlayerMeta } from '@/components/studio/ActivePlayerPane';
import { PublishConfirmDialog } from '@/components/studio/PublishConfirmDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  InlinePlayerProvider,
  useInlinePlayer,
  type InlinePlayerAsset,
} from '@/components/InlinePlayerProvider';
import { ownerHlsStreamUrl, ownerPosterStreamUrl, ownerPreviewStreamUrl } from '@/lib/playback';
import { MediaUpload } from '@/components/channels/media-upload';
import type { MediaAsset } from '@/lib/media-upload';
import Link from 'next/link';
import { Plus, Youtube } from 'lucide-react';
import { Button } from '@wideo11/ui/button';

import {
  productFocusRing,
  productPanel,
  productPanelHover,
  productSunken,
  productTextMuted,
} from '@wideo11/ui/design-system';

/** One kind's allowance, as the server measures it. */
type QuotaEntry = {
  kind: string;
  capability: string;
  limit: number;
  used: number;
  remaining: number;
  /** negative limit = unlimited. */
  unlimited: boolean;
};

type OwnChannel = {
  id: string;
  handle: string;
  display_name: string;
  cover_url?: string | null;
  image_url?: string | null;
  logo_url?: string | null;
  brand_hue?: number | null;
  subscriber_count?: number;
  created_at?: string;
};

/** The playlist asset the shared player consumes. */
function toPlayerAsset(a: MediaAsset): InlinePlayerAsset {
  return {
    id: a.id,
    filename: a.filename,
    kind: a.kind,
    duration_seconds: a.duration_seconds,
    width: a.width,
    height: a.height,
    // Owner-scoped: this is the creator's own library, so the session is the
    // authority and a private draft is still watchable by its uploader.
    hls_url: ownerHlsStreamUrl(a.hls_url, a.id),
    poster_url: ownerPosterStreamUrl(a.poster_public_url, a.id),
    subtitle: a.kind === 'reel' ? 'Reel' : a.kind === 'audio' ? 'Audio' : 'Video',
    watch_href: `/watch/${a.id}`,
  };
}

/**
 * The split. A separate component because it READS the player context, and a
 * component that reads it has to live inside the provider - calling the hook at
 * the top of the page component puts it outside, which throws at build time
 * during static generation.
 *
 * That is also the right split on its own terms: the data and the chrome above
 * do not care what is playing, and only this part does.
 */
function PlayerSplit({
  shown,
  loading,
  meta,
  onDeleted,
}: {
  shown: MediaAsset[];
  loading: boolean;
  // The player's own metadata type, rather than a local copy of its shape. A second
  // declaration of the same fields is a second place for a field to be forgotten -
  // and it was: `assetOwnerId` exists on `ActivePlayerMeta` but not on the inline
  // copy here, so the build failed the moment anything passed it.
  meta: ActivePlayerMeta;
  /**
   * Drops an asset from the caller's list.
   *
   * A callback rather than a `setAssets` passed down, because the list lives in
   * `StudioWorkspace` — this component only renders a page of it. Owning the
   * removal where the list is owned is what makes the deletion and the display
   * agree.
   */
  onDeleted: (assetId: string) => void;
}) {
  const { current, close, navigate, index, total } = useInlinePlayer();

  // ---- delete state ----
  //
  // A clip that was uploaded and should not be. The card reports the intent; the
  // confirmation and the API call live here, so a mis-click cannot delete
  // anything without a second, deliberate press.
  const [deleteTarget, setDeleteTarget] = useState<MediaAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setDeleteError(body.message ?? 'That clip could not be deleted.');
        setDeleting(false);
        return;
      }

      // Drop it through the caller, which owns the list.
      onDeleted(deleteTarget.id);

      // If the deleted clip is the one playing, close the player. Leaving it open
      // would leave a player pointing at an asset that no longer exists.
      if (current?.id === deleteTarget.id) close();

      setDeleteTarget(null);
      setDeleting(false);
    } catch {
      setDeleteError('Could not reach the service.');
      setDeleting(false);
    }
  }, [deleteTarget, current?.id, close, onDeleted]);

  // ---- publish state ----
  //
  // The asset awaiting confirmation, and the server's refusal if one comes back.
  // Both are null in the common case, so the whole block costs nothing when the
  // viewer is just browsing.
  const [publishTarget, setPublishTarget] = useState<MediaAsset | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [liveIds, setLiveIds] = useState<string[]>([]);

  const confirmPublish = useCallback(async () => {
    if (!publishTarget) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(publishTarget.id)}/publish`, {
        method: 'POST',
        cache: 'no-store',
      });

      if (!res.ok) {
        // The body carries the reason, and the refusal reasons are the two that
        // matter: not finished encoding, and not approved by screening. Both are
        // the backend's answer and this UI does not second-guess it.
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setPublishError(body.message ?? 'This clip could not be published.');
        setPublishing(false);
        return;
      }

      setLiveIds((prev) => (prev.includes(publishTarget.id) ? prev : [...prev, publishTarget.id]));
      setPublishTarget(null);
      setPublishing(false);
    } catch {
      setPublishError('Could not reach the service. Try again.');
      setPublishing(false);
    }
  }, [publishTarget]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      {/* Media Library - 2 of 5 */}
      <div className="min-w-0 xl:col-span-2">
        <MediaLibraryPane
          count={shown.length}
          loading={loading}
          emptyMessage="No media in this category yet. Drop a file above to get started."
        >
          {shown.map((a) => (
            <StudioMediaCard
              key={a.id}
              id={a.id}
              kind={a.kind}
              filename={a.filename}
              durationSeconds={a.duration_seconds}
              width={a.width}
              height={a.height}
              posterUrl={ownerPosterStreamUrl(a.poster_public_url, a.id)}
              previewUrl={ownerPreviewStreamUrl(a.hls_url, a.id)}
              playUrl={ownerHlsStreamUrl(a.hls_url, a.id)}
              watchHref={`/watch/${a.id}`}
              sortKey={a.created_at}
              matchKey={`${a.filename} ${a.kind}`}
              // The eligibility rule is the SCREENING verdict, and nothing else.
              // An asset that has not been approved never carries a publish
              // control, so "Go Live" cannot appear on unscreened material.
          eligibleForPublish={a.moderation_status === 'approved'}
          isLive={liveIds.includes(a.id) || Boolean(a.published_at)}
          onPublish={() => {
            setPublishTarget(a);
            setPublishError(null);
          }}
          onDelete={() => {
            setDeleteTarget(a);
            setDeleteError(null);
          }}
        />
          ))}
        </MediaLibraryPane>
      </div>

      {/* Active Player - 3 of 5. Only exists when something is playing: an empty
          player pane is a pane the viewer has to scroll past. */}
      {current ? (
        <div className="min-w-0 xl:col-span-3 xl:sticky xl:top-[76px] xl:self-start">
          <ActivePlayerPane
            asset={current}
            meta={meta}
            onClose={close}
            onNavigate={navigate}
            hasPrev={index > 0}
            hasNext={index >= 0 && index < total - 1}
          />
        </div>
      ) : null}

      {/* The gate between uploaded and live. Mounted only when a clip is
          awaiting confirmation, so it is never a stray dialog on page load. */}
      <PublishConfirmDialog
        open={publishTarget !== null}
        onClose={() => {
          if (!publishing) setPublishTarget(null);
        }}
        onConfirm={confirmPublish}
        assetTitle={publishTarget?.filename}
        confirming={publishing}
        error={publishError}
      />

      {/* The escape hatch for a clip that should not exist. Deliberately a
          SEPARATE dialog from the publish one: pressing "Go Live" and pressing
          "Delete" are opposite intents, and a combined dialog would make it
          possible to confirm the wrong one with a single mis-read click. */}
      {deleteTarget ? (
        <ConfirmDialog
          isOpen
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
          onConfirm={() => {
            void confirmDelete();
          }}
          title={`Delete "${deleteTarget.filename}"?`}
          message={
            deleteError ??
            'This permanently deletes the clip from your library and from anywhere it has been published. ' +
              'This action cannot be undone.'
          }
          confirmText={deleting ? 'Deleting…' : 'Delete'}
          variant="destructive"
        />
      ) : null}
    </div>
  );
}

/** The inner surface, split out so the provider sits above the part that reads it. */
function StudioWorkspace() {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [channels, setChannels] = useState<OwnChannel[]>([]);
  const [quotas, setQuotas] = useState<QuotaEntry[]>([]);
  const [category, setCategory] = useState<MediaCategory>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Files picked up by the dropzone. The uploader is driven by THIS rather than by
  // its own picker, so the box is the only way in and there is exactly one upload
  // pipeline on the page.
  const [picked, setPicked] = useState<File[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mediaRes, channelRes, quotaRes] = await Promise.all([
        fetch('/api/media?limit=50', { cache: 'no-store' }),
        fetch('/api/channels', { cache: 'no-store' }),
        fetch('/api/media/quota', { cache: 'no-store' }),
      ]);

      const mediaBody = (await mediaRes.json().catch(() => ({}))) as { assets?: MediaAsset[] };
      if (mediaRes.ok) setAssets(mediaBody.assets ?? []);

      const channelBody = await channelRes.json().catch(() => ({}));
      // Tolerate both `[...]` and `{ channels: [...] }`, so a shape change
      // degrades to no header rather than a crash.
      const list = Array.isArray(channelBody)
        ? channelBody
        : (channelBody as { channels?: OwnChannel[] }).channels ?? [];
      setChannels(list);
      // A channel failure is not fatal: uploading without a channel is valid and
      // the creator can re-file later.

      if (quotaRes.ok) {
        const quotaBody = (await quotaRes.json().catch(() => ({}))) as { quotas?: QuotaEntry[] };
        setQuotas(quotaBody.quotas ?? []);
      }

      setLoadError(null);
    } catch {
      setLoadError('Could not load your media. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onStored = useCallback((asset: MediaAsset) => {
    // Prepend rather than refetch: the response already carries the asset in full,
    // and a round trip to learn something we have is a flicker for nothing.
    setAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
    void (async () => {
      try {
        const res = await fetch('/api/media/quota', { cache: 'no-store' });
        if (res.ok) {
          const body = (await res.json()) as { quotas?: QuotaEntry[] };
          setQuotas(body.quotas ?? []);
        }
      } catch {
        /* the numbers stay as they were - the upload itself is unaffected */
      }
    })();
  }, []);

  // Only playable clips reach the library and the playlist: a clip that is still
  // transcoding has nothing to play and nothing to show in the player.
  const playable = useMemo(
    () => assets.filter((a) => a.status === 'ready' && a.hls_url),
    [assets]
  );

  // ---- channel filter ----
  //
  // A dropdown rather than another row of sidebar tabs, because the sidebar is
  // already full and a second full rail of channel names would flip it to two
  // columns. One dropdown with "All Media" first does the same job in one row.
  //
  // Filtering happens in memory over rows the page already holds: a round trip per
  // selection would put a spinner between the creator and the thing they clicked,
  // to answer a question the loaded list can answer.
  const [channelFilter, setChannelFilter] = useState<string>('all');

  // The distinct channels this creator actually has files under, derived rather
  // than fetched. A channel they have uploaded nothing to would be an option that
  // shows an empty grid - which looks like a bug rather than like an empty channel.
  const channelOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const a of playable) {
      if (!a.channel_id) continue;
      // The first name seen wins, so a rename does not split one channel into two
      // options because one stale row carries the old string.
      if (!byId.has(a.channel_id)) byId.set(a.channel_id, a.channel_name ?? 'Unnamed channel');
    }
    return Array.from(byId, ([id, name]) => ({ id, name })).sort((x, y) =>
      x.name.localeCompare(y.name)
    );
  }, [playable]);

  // Clamped: if a filter names a channel whose last clip was just deleted, the
  // dropdown would otherwise select an option that no longer exists and render an
  // empty grid for it.
  const effectiveFilter =
    channelFilter === 'all' || channelOptions.some((c) => c.id === channelFilter)
      ? channelFilter
      : 'all';

  const channelFiltered = useMemo(
    () =>
      effectiveFilter === 'all'
        ? playable
        : playable.filter((a) => a.channel_id === effectiveFilter),
    [playable, effectiveFilter]
  );

  const counts = useMemo(() => {
    const out: Partial<Record<MediaCategory, number>> = { all: channelFiltered.length };
    for (const c of ['video', 'reel-long', 'reel-short', 'horizontal', 'vertical', 'audio'] as MediaCategory[]) {
      out[c] = channelFiltered.filter((a) => matchesCategory(a, c)).length;
    }
    return out;
  }, [channelFiltered]);

  const shown = useMemo(
    () => channelFiltered.filter((a) => matchesCategory(a, category)),
    [channelFiltered, category]
  );

  // The ordered playlist the player's arrows walk, in the grid's own order.
  const playlist = useMemo(() => shown.map(toPlayerAsset), [shown]);

  // The header shows the creator's own channel. Name and handle identify the same
  // thing here, which is the honest reading of an owner's studio.
  const header = channels[0];

  // Early return when no channels (and not loading) - show CTA to create one
  if (!loading && channels.length === 0) {
    return (
      <div className={`flex min-h-screen ${productSunken} text-white`}>
        <StudioSidebar active={category} onSelect={setCategory} counts={counts} />
        <div className="min-w-0 flex-1">
          <StudioHeader />
          <main className="space-y-4 p-4 sm:p-5">
            <ChannelHeaderCard
              displayName={header?.display_name}
              handle={header?.handle}
              creator={header?.display_name}
              subscribers={formatSubscribers(header?.subscriber_count ?? 0)}
              joined={formatJoined(header?.created_at)}
              coverUrl={header?.cover_url}
              avatarUrl={header?.logo_url || header?.image_url}
              brandHue={header?.brand_hue}
            />
            {/* ---- no channels: show CTA to create one ---- */}
            <div className={`flex flex-col items-center justify-center py-12 rounded-2xl ${productPanel} text-center`}>
              <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${productSunken}`}>
                <Youtube className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Create a channel first</h3>
              <p className={`${productTextMuted} text-sm mb-6 max-w-xs`}>
                You need at least one channel to upload videos. Create your channel to get started.
              </p>
              <Link
                href="/dashboard/channels/setup"
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl font-medium text-white transition-colors ${productFocusRing} focus:outline-none focus:ring-2`}
                style={{ background: "linear-gradient(135deg, #ff6500 0%, #e05500 100%)" }}
              >
                <Plus className="h-4 w-4" />
                Create Channel
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen ${productSunken} text-white`}>
      <StudioSidebar active={category} onSelect={setCategory} counts={counts} />

      <div className="min-w-0 flex-1">
        <StudioHeader />

        <main className="space-y-4 p-4 sm:p-5">
              {/* ---- the uploader ----
                  ONE dropzone, not two. This page used to render its own dashed box
                  above `MediaUpload`, which renders its own dashed box as well - so a
                  creator saw two identical drop targets and neither was clearly "the"
                  one. The one that survives is `MediaUpload`'s, because it owns the
                  whole presign -> PUT -> finalize -> transcode chain AND its own file
                  input, drag state and progress. A second box that only forwarded its
                  files here was a decoration around a working control. */}
              <MediaUpload
                channels={channels.map((c) => ({ id: c.id, label: c.display_name || c.handle }))}
                files={picked}
                onStored={onStored}
                onQueued={() => setPicked([])}
              />

              {/* ---- what the plan allows ----
                  Shown BEFORE the file picker, because the alternative is a creator
                  choosing a file, waiting for its hash, then being told a capability name
                  they have no context for. */}
              {quotas.length > 0 ? (
                <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl ${productPanel} px-3 py-2.5 text-xs ${productTextMuted}`}>
                  {quotas.map((q) => (
                    <span key={q.kind} className="inline-flex items-center gap-1.5">
                      <span className="font-medium capitalize text-white">{q.kind}</span>
                      {q.unlimited ? (
                        <span>unlimited</span>
                      ) : (
                        <span>
                          {q.remaining} of {q.limit} left
                          {q.used > 0 ? ` (${q.used} used)` : ''}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ) : null}

              {loadError ? (
                <p className="rounded-2xl bg-red-500/5 px-3 py-2 text-xs text-red-300">{loadError}</p>
              ) : null}

              {/* ---- the split ---- */}
              <InlinePlayerProvider playlist={playlist}>
            {/* Channel filter, one row above the library. "All Media" is first so
                the broadest view is the default and narrowing is a deliberate act. */}
            {channelOptions.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label
                  htmlFor="studio-channel-filter"
                  className={`text-[10px] font-semibold uppercase tracking-wider ${productTextMuted}`}
                >
                  Channel
                </label>
                <div className="relative">
                  <select
                    id="studio-channel-filter"
                    value={effectiveFilter}
                    onChange={(e) => setChannelFilter(e.target.value)}
                    className={`appearance-none rounded-xl ${productPanel} py-1.5 pl-3 pr-8 text-xs font-medium text-white transition-colors ${productPanelHover} focus:outline-none focus:ring-1 ${productFocusRing}`}
                  >
                    <option value="all">All Media ({playable.length})</option>
                    {channelOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <svg
                    viewBox="0 0 24 24"
                    className={`pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 ${productTextMuted}`}
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </div>
                {effectiveFilter !== 'all' ? (
                  <span className={`text-[11px] ${productTextMuted}`}>
                    {channelFiltered.length} clips in this channel
                  </span>
                ) : null}
              </div>
            ) : null}

            <PlayerSplit
              shown={shown}
              loading={loading}
              onDeleted={(assetId) => setAssets((prev) => prev.filter((a) => a.id !== assetId))}
              meta={{
                creator: header?.display_name,
                channel: header?.handle,
                creatorAvatar: header?.logo_url || header?.image_url,
                date: header?.created_at,
                // The clip owner, so the comment section can offer delete. The
                // server re-checks this from the asset's own row, so this is a hint
                // for rendering and never an authorisation.
                assetOwnerId: undefined,
              }}
            />
          </InlinePlayerProvider>
        </main>
      </div>
    </div>
  );
}

export default function StudioUploadPage() {
  return <StudioWorkspace />;
}
