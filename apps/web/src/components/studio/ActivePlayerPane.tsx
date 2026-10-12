'use client';

/**
 * ACTIVE PLAYER PANE - the player plus its context, as one unit.
 *
 * =============================================================================
 * WHAT THIS IS AND IS NOT
 * =============================================================================
 *
 * This is the LAYOUT AROUND a player, not another player. The player itself is
 * `components/InlinePlayer`, and this file deliberately contains no playback
 * logic - no hls.js, no transport controls, no quality menu. Those were here once
 * and they were a 450-line copy of `InlinePlayer`, which meant a playback bug had
 * to be found and fixed twice, and the two copies had already drifted on the
 * skip buttons.
 *
 * So: `InlinePlayer` plays. This adds what a player does not own - the
 * Title/Creator/Channel/Date cards and the comments.
 *
 * =============================================================================
 * WHY THE INFO CARDS ARE CARDS AND NOT A PARAGRAPH
 * =============================================================================
 *
 * They are the answers to four different questions, and each is scannable alone.
 * A paragraph makes a viewer read to find out who uploaded it; a row of cards
 * makes them glance. That is also why each card carries its own label - a value
 * with no label ("congressmlasecondchannel") is a value nobody can place.
 */

import { useCallback, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { InlinePlayer, type InlinePlayerAsset } from '../InlinePlayerProvider';
import { Comments, type Comment } from './Comments';

// The asset type lives with the player, so it is aliased here rather than
// redeclared. A second copy is a second place for a player prop to drift.
export type ActivePlayerAsset = InlinePlayerAsset;

export interface ActivePlayerMeta {
  /** Channel name, shown as the Creator value. */
  creator?: string;
  /** @handle, shown as the Channel value. */
  channel?: string;
  /** Channel avatar, for the creator card. */
  creatorAvatar?: string | null;
  /** ISO date, or anything `Date` accepts. */
  date?: string;
  /**
   * The clip's owner. The server re-checks this from the asset's own row, so this
   * is only used to decide whether to RENDER the delete affordance - it is a hint
   * and never an authorisation.
   */
  assetOwnerId?: string;
}

interface ActivePlayerPaneProps {
  asset: ActivePlayerAsset | null;
  meta?: ActivePlayerMeta;
  onClose: () => void;
  onNavigate?: (direction: 'prev' | 'next') => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function ActivePlayerPane({
  asset,
  meta,
  onClose,
  onNavigate,
  hasPrev = false,
  hasNext = false,
}: ActivePlayerPaneProps) {  // The player's own subtitle line is the creator, which is the one thing the
  // header wants to show that the info cards show in full below.
  const playerAsset: ActivePlayerAsset | null = asset
    ? { ...asset, subtitle: meta?.creator ?? asset.subtitle ?? null }
    : null;

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto"
      style={{ scrollbarWidth: 'thin' }}
      data-active-player=""
    >
      <InlinePlayer
        asset={playerAsset}
        onClose={onClose}
        onNavigate={onNavigate}
        hasPrev={hasPrev}
        hasNext={hasNext}
      />

      {/* ---- info cards ----
          Four rounded cards, each answering one question with its own label. */}
      <div className="grid shrink-0 grid-cols-2 gap-2.5">
        <InfoCard label="Title" value={asset?.filename ?? ''} />
        <InfoCard label="Creator" value={meta?.creator ?? 'Unknown'} avatar={meta?.creatorAvatar} />
        <InfoCard label="Channel" value={meta?.channel ? `@${meta.channel}` : 'Unknown'} />
        <InfoCard
          label="Date"
          value={
            meta?.date
              ? new Date(meta.date).toLocaleDateString(undefined, { dateStyle: 'medium' })
              : 'Unknown'
          }
        />
      </div>

      {/* ---- comments ---- */}
      {asset ? <Comments assetId={asset.id} assetOwnerId={meta?.assetOwnerId} /> : null}
    </div>
  );
}

/** One label-plus-value card. */
function InfoCard({
  label,
  value,
  avatar,
}: {
  label: string;
  value: string;
  avatar?: string | null;
}) {
  return (
    <div className="rounded-xl bg-[#16181d] p-3 shadow-md shadow-black/20">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-[#8b949e]">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
        ) : null}
        <p className="truncate text-xs font-medium text-white" title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}

