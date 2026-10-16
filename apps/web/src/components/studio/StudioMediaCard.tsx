'use client';

/**
 * STUDIO MEDIA CARD - one clip in the library, in grid or list form.
 *
 * =============================================================================
 * WHAT THIS IS AND IS NOT
 * =============================================================================
 *
 * This is a CARD, not a thumbnail and not a player. It composes:
 *
 *   `HoverPreviewThumbnail` - poster + the silent preview that plays on hover,
 *                             and the play button that opens the shared player
 *   this file              - the studio's own chrome: active glow, caption,
 *                            metadata, and the sort/search keys the library
 *                            pane reads
 *
 * The hover preview and the play affordance were here once, and they were a
 * second copy of `HoverPreviewThumbnail`'s. Two copies of "preview on hover" is
 * two places for the leak-fix to land, and the leak fix is the subtle part.
 *
 * =============================================================================
 * WHY THE GLOW IS A RING
 * =============================================================================
 *
 * `ring` rather than `border`, so the card's own rounded rectangle is unchanged
 * and the glow never shifts the grid by a pixel when it appears. A border would
 * reflow every card in the row at the moment one of them starts playing.
 *
 * =============================================================================
 * sortKey / matchKey
 * =============================================================================
 *
 * The library pane sorts and filters by reading these off the element. They are
 * props rather than a data attribute because the pane already walks the React
 * tree, and reading a prop is the only way to get a typed, comparable value.
 */

import { Play, Radio, Trash2 } from 'lucide-react';
import { HoverPreviewThumbnail } from '../HoverPreviewThumbnail';
import { formatDuration } from '@/lib/media-upload';
import { useInlinePlayer, type InlinePlayerAsset } from '../InlinePlayerProvider';

import {
  productAccent,
  productAccentBg,
  productAccentHoverBg,
  productAccentSoftBg,
  productActiveRing,
  productPanel,
  productPanelHover,
  productSunken,
  productTextMuted,
} from '@wideo11/ui/design-system';

type MediaKind = 'video' | 'reel' | 'audio';

export interface StudioMediaCardProps {
  id: string;
  kind: MediaKind;
  filename: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  posterUrl?: string | null;
  /** Resolved low-quality playlist URL, for the hover preview. Null disables it. */
  previewUrl?: string | null;
  /** Resolved full-quality playlist URL. Null means "not playable". */
  playUrl?: string | null;
  subtitle?: string | null;
  badge?: React.ReactNode;
  /** Small or medium card size. */
  size?: 'small' | 'medium';
  /** Renders the list row variant rather than the grid tile. */
  variant?: 'grid' | 'list';
  /** Sort value for the library's "Sort By". */
  sortKey?: string | number;
  /** Text the library's search box matches against. */
  matchKey?: string;
  watchHref?: string;
  /**
   * Opens a delete confirmation for this clip.
   *
   * The card does NOT delete anything itself. It reports the intent and the
   * caller owns the confirmation and the API call — a card that deleted directly
   * would delete a clip on a mis-click with no undo, and the owner needs to be
   * the one to confirm.
   */
  onDelete?: () => void;
  /**
   * Whether this clip has passed the mandatory checks and may be offered for
   * publication. Absent means no publish affordance at all, which is the correct
   * default: offering "Go Live" on an unscreened clip is the bug this prop
   * prevents.
   */
  eligibleForPublish?: boolean;
  /** Already live. Renders a read-only state instead of a button. */
  isLive?: boolean;
  /** Opens the publish confirmation dialog for this clip. */
  onPublish?: () => void;
}

/** The 60 s boundary between a short reel and a long one. */
const REEL_LONG_SECONDS = 60;

/** The aspect a card's thumbnail should be, from what the clip actually is. */
type CardAspect = '16:9' | '9:16' | '1:1' | 'short-reel' | 'long-reel';

/**
 * THE ASPECT, DERIVED FROM THE CLIP RATHER THAN ASSUMED.
 *
 * Every card in this app used to render `16:9`, which is wrong for four of the
 * five shapes the platform carries. The schematic blueprint is explicit:
 *
 *	a video        -> landscape
 *	a tall reel    -> PORTRAIT, taller than wide
 *	a short reel   -> compact, between the two
 *	a long reel    -> an extreme letterbox, ~4:1
 *	audio          -> square
 *
 * The width/height check comes BEFORE the kind check, and that order is the point:
 * a reel stored as 9:16 and a portrait video are the same pixels, and asking "is
 * this portrait?" first answers for both. Checking `kind` first would render a
 * portrait VIDEO as a landscape card because its kind happened to say `video`.
 */
export function cardAspect(
  kind: MediaKind,
  durationSeconds = 0,
  width = 0,
  height = 0
): CardAspect {
  if (kind === 'audio') return '1:1';
  // Orientation is a fact about the file, so it wins over any inference from kind.
  if (width > 0 && height > 0 && height > width) return '9:16';
  if (kind === 'reel') {
    return durationSeconds >= REEL_LONG_SECONDS ? 'long-reel' : 'short-reel';
  }
  return '16:9';
}

export function StudioMediaCard({
  id,
  kind,
  filename,
  durationSeconds = 0,
  width,
  height,
  posterUrl,
  previewUrl,
  playUrl,
  subtitle,
  badge,
  size = 'medium',
  variant = 'grid',
  sortKey,
  matchKey,
  watchHref,
  onDelete,
  eligibleForPublish = false,
  isLive = false,
  onPublish,
}: StudioMediaCardProps) {
  const { play, current } = useInlinePlayer();
  const isActive = current?.id === id;
  const canPlay = Boolean(playUrl);

  const asset: InlinePlayerAsset = {
    id,
    filename,
    kind,
    duration_seconds: durationSeconds,
    width,
    height,
    hls_url: playUrl ?? null,
    poster_url: posterUrl ?? null,
    subtitle: subtitle ?? null,
    watch_href: watchHref,
  };

  const activate = () => {
    if (canPlay) play(asset);
  };

  const glow = isActive
    ? `${productActiveRing}`
    : 'ring-1 ring-transparent hover:ring-[#2c3235]';

  // ---- list variant ----
  //
  // Compact YouTube-style list row: thumbnail left, metadata middle, actions right.
  // Row height is kept in step with grid cards by using a tight thumbnail box,
  // single-line text, and minimal padding - the row never grows taller than a
  // grid card's thumbnail + caption, so grid and list feel the same density.
  if (variant === 'list') {
    return (
      <article
        role="listitem"
        data-studio-card=""
        data-active={isActive ? 'true' : 'false'}
        data-asset-id={id}
        aria-label={filename}
        onClick={activate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        }}
        tabIndex={0}
        className={`group flex cursor-pointer items-center gap-2 rounded-xl ${productPanel} p-1 transition-colors ${productPanelHover} ${glow}`}
      >
        {/* ---- thumbnail: fixed 16:9 box matching grid card proportions ---- */}
        <div
          className={`relative shrink-0 overflow-hidden rounded-lg bg-black ${
            size === 'small' ? 'h-6 w-[48px]' : 'h-9 w-[64px]'
          }`}
        >
          <HoverPreviewThumbnail
            id={id}
            kind={kind}
            filename={filename}
            posterUrl={posterUrl}
            previewUrl={previewUrl}
            durationSeconds={durationSeconds}
            aspect="fill"
            className="!rounded-none !bg-transparent"
            showCaption={false}
            onPlayClick={activate}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white leading-tight" title={filename}>
            {filename}
          </p>
          <div className={`mt-0.5 flex flex-wrap items-center gap-1 text-[9px] ${productTextMuted}`}>
            <span className={`rounded ${productSunken} px-1 py-0.5 capitalize`}>{kind}</span>
            {durationSeconds > 0 ? <span>{formatDuration(durationSeconds)}</span> : null}
            {width && height ? <span>
                {width}x{height}
              </span> : null}
            {subtitle ? <span className="truncate">{subtitle}</span> : null}
          </div>
        </div>

        {isActive ? (
          <span className={`shrink-0 rounded-full ${productAccentSoftBg} px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${productAccent}`}>
            Playing
          </span>
        ) : (
          <>
            <PublishAffordance
              eligible={eligibleForPublish && canPlay}
              isLive={isLive}
              onPublish={onPublish}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                activate();
              }}
              disabled={!canPlay}
              aria-label={`Play ${filename}`}
              title={canPlay ? 'Play here' : 'Not playable yet'}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${productAccentBg} text-white transition-colors ${productAccentHoverBg} disabled:opacity-40`}
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            {onDelete ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label={`Delete ${filename}`}
                title="Delete"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${productSunken} text-red-400 transition-colors hover:bg-red-500/20`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </>
        )}
      </article>
    );
  }

  // ---- grid variant ----
  return (
    <article
      role="listitem"
      data-studio-card=""
      data-active={isActive ? 'true' : 'false'}
      data-asset-id={id}
      aria-label={filename}
      className={`group relative overflow-hidden rounded-xl ${productPanel} transition-colors ${productPanelHover} ${glow}`}
    >
      <HoverPreviewThumbnail
        id={id}
        kind={kind}
        filename={filename}
        posterUrl={posterUrl}
        previewUrl={previewUrl}
        durationSeconds={durationSeconds}
        // Derived, not fixed. This was `16:9` for everything, so a portrait reel
        // rendered as a landscape card with black bars and a long reel lost a third
        // of its height to bars. See `cardAspect` for why orientation is checked
        // before kind.
        aspect={cardAspect(kind, durationSeconds, width, height)}
        badge={badge}
        showCaption={false}
        // The thumbnail owns the poster, the hover preview AND the play button.
        // Restricting its own click to the button means a click elsewhere on the
        // frame falls through to nothing - so the card's own handler does it.
        onPlayClick={activate}
        onOpen={activate}
        className="!rounded-none"
      />

      {/* ---- caption + action row ---- */}
      <div className="p-2">
        <p className="truncate text-[11px] font-medium text-white" title={filename}>
          {filename}
        </p>
        <p className={`mt-0.5 truncate text-[10px] ${productTextMuted}`}>
          {canPlay ? (durationSeconds > 0 ? formatDuration(durationSeconds) : 'Ready') : 'Not ready'}
          {subtitle ? ` · ${subtitle}` : ''}
        </p>

        {/* The action row: Play | Go Live | Delete, icons only.
            All three sit here in the card footer rather than on the thumbnail, so
            the frame stays a clean hover-preview surface. Each is an icon plus a
            tooltip - the words they used to carry ("Play", "Go Live", "Live")
            overflowed a narrow card and overlapped each other. */}
        <div className="mt-1.5 flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              activate();
            }}
            disabled={!canPlay}
            aria-label={`Play ${filename}`}
            title={canPlay ? 'Play here' : 'Not playable yet'}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${productAccentBg} text-white transition-colors ${productAccentHoverBg} disabled:opacity-40`}
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <PublishAffordance
            eligible={eligibleForPublish && canPlay}
            isLive={isLive}
            onPublish={onPublish}
          />

          {onDelete ? (
            <button
              onClick={(e) => {
                // Without this the click also activates the card behind it, so a
                // delete would open the confirm dialog AND the player.
                e.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete ${filename}`}
              title="Delete"
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${productSunken} text-red-400 transition-colors hover:bg-red-500/20`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {isActive ? (
        <span className={`pointer-events-none absolute left-1.5 top-1.5 rounded-full ${productAccentBg} px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white`}>
          Playing
        </span>
      ) : null}
    </article>
  );
}

/**
 * The "Go Live" affordance.
 *
 * Three states, and each one is distinct rather than collapsed into "a button that
 * may or may not work":
 *
 *	live      - read-only, because a published clip has nothing to publish
 *	eligible  - the clickable one, which is the ONLY thing on the card that is not
 *	            a play action
 *	otherwise - absent, so an unscreened clip never carries a publish control
 *
 * `stopPropagation` matters: without it, a click on the button also activates the
 * card behind it, and the viewer gets a publish dialog AND a player.
 */
function PublishAffordance({
  eligible,
  isLive,
  onPublish,
}: {
  eligible: boolean;
  isLive: boolean;
  onPublish?: () => void;
}) {
  if (isLive) {
    // Icon only, no text. The text was removed because on a narrow card the
    // word "Live" plus a radio glyph plus the Play and Delete icons overflowed
    // and overlapped each other. The tooltip carries what the text used to.
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-red-500/15 text-red-400"
        title="This clip is live"
        aria-label="Live"
      >
        <Radio className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    );
  }
  if (!eligible) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onPublish?.();
      }}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${productAccentBg} text-white transition-colors ${productAccentHoverBg}`}
      title="Go live — publish this clip"
      aria-label="Go live"
    >
      <Radio className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
