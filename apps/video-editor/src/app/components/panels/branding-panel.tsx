'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Loader2, Check, RefreshCw, Trash2, Image as ImageIcon, Sparkles } from 'lucide-react';
import { PanelSection, Button, Field, Select, TextInput } from './panel-kit';
import type { TimelineTrack, TimelineClip } from '../../lib/engine/types';
import { nextId, BRANDING_PRESETS, getBrandingPreset } from '../../lib/engine/types';

interface Channel {
  id: string;
  handle: string;
  display_name: string;
  logo_url: string;
  brand_hue: number | null;
}

interface BrandingPanelProps {
  tracks: TimelineTrack[];
  onAddClip: (clip: TimelineClip, trackId: string) => void;
  onRemoveClip: (clipId: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<TimelineClip>) => void;
  /** File for the sponsor slot, or the user's own second logo. */
  onAddSponsor: (file: File) => void;
  onRemoveSponsor: (clipId: string) => void;
}

export function BrandingPanel({
  tracks,
  onAddClip,
  onRemoveClip,
  onUpdateClip,
  onAddSponsor,
  onRemoveSponsor,
}: BrandingPanelProps) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const brandingTrack = tracks.find((t) => t.type === 'branding');
  // The CHANNEL slot. A clip with no role is a channel logo: that is what every
  // project saved before the field existed contains, and reading it as a sponsor
  // would take the user's logo away on the first open.
  const existingClip = brandingTrack?.clips.find((c) => c.brandingRole !== 'sponsor') ?? null;
  const sponsorClip = brandingTrack?.clips.find((c) => c.brandingRole === 'sponsor') ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/channels', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.channels) {
        setChannels(data.channels as Channel[]);
      }
    } catch {
      setMessage({ ok: false, text: 'Could not load channels' });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
 * Which of the device presets the clip on the timeline is currently set to, inferred
 * from where it actually is. Read off the clip rather than remembered in state: the
 * user can move a logo in the inspector, and a remembered selection would then
 * disagree with what is on screen.
 */
   const activePresetId = useMemo(() => {
    if (!existingClip) return 'widescreen';
    const t = existingClip.transform;
    const hit = BRANDING_PRESETS.find((p) => p.corner === t.corner && Math.abs(p.size - t.pipSize) < 0.005);
    return hit?.id ?? 'custom';
  }, [existingClip]);

  /**
   * The preset a given id names, with a fallback for the synthetic `'custom'`.
   * Used by the readout when no clip is on the timeline yet, so the panel shows what
   * WOULD be applied instead of a placeholder.
   */
     const presetFor = (id: string) => getBrandingPreset(id === 'custom' ? 'widescreen' : id);

  /**
   * Move the existing logo to a delivery target's corner and size.
   *
   * Writing `x`/`y` back to `0.5, 0.5` is deliberate: that is the sentinel the
   * compositor reads as "no explicit position", so the corner takes over. Without
   * it, a logo the user had dragged would keep its dragged coordinates and the
   * preset would appear to do nothing.
   */
  const applyPreset = useCallback(
    (presetId: string) => {
      if (!existingClip) return;
      const p = getBrandingPreset(presetId);
      onUpdateClip(existingClip.id, {
        transform: { ...existingClip.transform, corner: p.corner, pipSize: p.size, x: 0.5, y: 0.5, scale: 1 },
      });
      setMessage({ ok: true, text: `Logo moved to ${p.label.toLowerCase()} (${p.corner.replace('-', ' ')})` });
    },
    [existingClip, onUpdateClip]
  );

  const applyBranding = useCallback(async (channel: Channel) => {
    if (!brandingTrack) {
      setMessage({ ok: false, text: 'No branding track found' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      // Get full channel details including logo position and auto-size
      const setupRes = await fetch(`/api/channels/${channel.id}/setup`, { cache: 'no-store' });
      const setupData = await setupRes.json().catch(() => ({}));

      const fullChannel = setupData?.channel ? {
        ...channel,
        logo_url: setupData.channel.logo_url || channel.logo_url,
        brand_hue: setupData.channel.brand_hue ?? channel.brand_hue,
      } : channel;

      if (!fullChannel.logo_url) {
        setMessage({ ok: false, text: 'This channel has no logo. Upload one in channel setup.' });
        return;
      }

      // Position comes from the PROJECT, not the channel — see `BRANDING_PRESETS`.
      // Re-applying a channel must therefore not move a logo the user has already
      // positioned; it refreshes the image and leaves the placement alone.
      // Captured as a const so the null check narrows once, rather than the type
      // being re-tested three lines later through a boolean it cannot see into.
      const current = existingClip;
      const keepPlacement = current !== null;
      const preset = getBrandingPreset(activePresetId === 'custom' ? 'widescreen' : activePresetId);

      // Create or update the branding clip
      const clipId = existingClip?.id ?? nextId('clip');
      const duration = 3600; // 1 hour - spans the whole project

      const clip: TimelineClip = {
        id: clipId,
        mediaId: fullChannel.id,
        mediaName: `Branding: ${fullChannel.display_name}`,
        startTime: 0,
        duration,
        type: 'branding',
        url: fullChannel.logo_url,
        thumbnail: fullChannel.logo_url,
        poster: fullChannel.logo_url,
        effects: [],
        sourceIn: 0,
        speed: 1,
        volume: 0,
        muted: true,
        opacity: 0.9,
        fadeIn: 0,
        fadeOut: 0,
        filter: {
          brightness: 1,
          contrast: 1,
          saturate: 1,
          hue: 0,
          blur: 0,
          grayscale: 0,
          sepia: 0,
          invert: 0,
          temperature: 0,
        },
        transform: {
          x: 0.5,
          y: 0.5,
          scale: 1,
          rotation: 0,
          fit: 'pip',
          corner: keepPlacement ? current.transform.corner : preset.corner,
          pipSize: keepPlacement ? current.transform.pipSize : preset.size,
          zoomStart: 1,
          zoomEnd: 1,
          panX: 0,
          panY: 0,
        },
      };

      if (existingClip) {
        onUpdateClip(clipId, clip);
        setMessage({ ok: true, text: `Branding updated for @${fullChannel.handle}` });
      } else {
        onAddClip(clip, brandingTrack.id);
        setMessage({ ok: true, text: `Branding applied from @${fullChannel.handle}` });
      }

      setSelectedChannelId(fullChannel.id);
    } catch {
      setMessage({ ok: false, text: 'Failed to apply branding' });
    } finally {
      setLoading(false);
    }
  }, [brandingTrack, existingClip, onAddClip, onRemoveClip, onUpdateClip]);

  const clearBranding = useCallback(() => {
    if (existingClip) {
      onRemoveClip(existingClip.id);
      setSelectedChannelId(null);
      setMessage({ ok: true, text: 'Branding removed' });
    }
  }, [existingClip, onRemoveClip]);

  const refreshBranding = useCallback(() => {
    if (selectedChannelId) {
      const ch = channels.find((c) => c.id === selectedChannelId);
      if (ch) applyBranding(ch);
    }
  }, [selectedChannelId, channels, applyBranding]);

  return (
    <div className="space-y-4">
      <PanelSection title="Channel Branding" hint="Select a channel to automatically apply its logo, colour and position to the branding track (top-most, locked).">
        {channels.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md-dashed-[#2c3235] p-6 text-center">
            <Badge className="mx-auto h-10 w-10 text-[#9fa7b3]" />
            <p className="text-sm text-[#d8d9da]">No channels found</p>
            <p className="text-xs text-[#9fa7b3]">
              Create a channel in the dashboard and add a logo to use branding.
            </p>
            <Button onClick={loadChannels} variant="outline" className="mt-2">
              <RefreshCw className="mr-1.5 h-2.5 w-2.5" />
              Refresh
            </Button>
          </div>
        ) : (
          <>
            <Field label="Channel">
              <Select
                value={selectedChannelId ?? ''}
                ariaLabel="Select channel for branding"
                options={channels.map((c) => ({ value: c.id, label: `@${c.handle} — ${c.display_name}` }))}
                onChange={(v) => {
                  const ch = channels.find((c) => c.id === v);
                  if (ch) applyBranding(ch);
                }}
              />
            </Field>

            {/* Shown whenever a logo is on the timeline, not only while a channel is
                selected. Placement is a property of the PROJECT, so it has to stay
                reachable after the channel dropdown is forgotten — and after a
                reload, when there is a logo but no channel selection to hang it
                off. */}
            {(selectedChannelId || existingClip) && (
              <div className="rounded-md bg-[#101216] p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#181b1f]" style={{ borderColor: `hsl(${channels.find(c => c.id === selectedChannelId)?.brand_hue || 200} 50% 50%)` }}>
                    {channels.find(c => c.id === selectedChannelId)?.logo_url ? (
                      <img src={channels.find(c => c.id === selectedChannelId)!.logo_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-xs font-bold text-[#9fa7b3]">
                        {channels.find(c => c.id === selectedChannelId)?.display_name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[#d8d9da]">
                      {channels.find(c => c.id === selectedChannelId)?.display_name}
                    </p>
                    <p className="truncate text-xs text-[#9fa7b3]">
                      @{channels.find(c => c.id === selectedChannelId)?.handle}
                    </p>
                  </div>
                  <span className="ml-auto inline-flex items-center gap-1 rounded bg-emerald-950/60 px-2 py-0.5 text-emerald-300 text-[10px]">
                    <Check className="h-2.5 w-2.5" />
                    Active
                  </span>
                </div>

                {/* ---- WHAT IS TRUE, READ OFF THE CLIP ----

                    These two used to read `logo_position` and `logo_auto_size` off
                    the channel. Neither field exists on the backend, so both were
                    permanently `undefined` and the panel displayed its own
                    fallbacks — a confident, wrong readout of a setting the user had
                    never chosen. The truth is on the clip, so that is what is shown. */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[#9fa7b3]">Position</p>
                    <p className="font-medium capitalize">
                      {(existingClip?.transform.corner ?? presetFor(activePresetId).corner).replace('-', ' ')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[#9fa7b3]">Width</p>
                    <p className="font-medium">
                      {Math.round((existingClip?.transform.pipSize ?? presetFor(activePresetId).size) * 100)}% of frame
                    </p>
                  </div>
                </div>

                {/* ---- DEVICE PRESETS ----
                    The three delivery targets, each with the corner its logo belongs
                    in. Selecting one moves the existing logo; it is a placement
                    choice about the PROJECT, so it cannot live on the channel. */}
                <div className="pt-1">
                  <p className="mb-1.5 text-[#9fa7b3]">Placement for</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BRANDING_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPreset(p.id)}
                        disabled={!existingClip}
                        title={p.hint}
                        aria-pressed={activePresetId === p.id}
                        className={`rounded px-1.5 py-1.5 text-[10px] leading-tight transition-colors ${
                          activePresetId === p.id
                            ? 'border-pink-500 bg-pink-500/15 text-pink-200'
                            : 'border-[#2c3235] text-[#9fa7b3] hover:border-pink-500/50 hover:text-[#d8d9da]'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button onClick={refreshBranding} variant="outline" disabled={loading}>
                    {loading ? <Loader2 className="mr-1.5 h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-2.5 w-2.5" />}
                    Refresh
                  </Button>
                  <Button onClick={clearBranding} variant="danger">
                    <Trash2 className="mr-1.5 h-2.5 w-2.5" />
                    Remove
                  </Button>
                </div>
              </div>
            )}

            {!selectedChannelId && (
              <p className="text-xs text-[#9fa7b3]">
                Choose a channel to apply its logo to the branding track, then pick where it sits
                for the platform you are publishing to.
              </p>
            )}
          </>
        )}

        {/* ---- SPONSOR SLOT ----

            A second mark, in another corner, for a sponsor or for the creator's own
            second logo. It comes from an image in the user's library rather than from
            the channel, because there is no second-logo field on the channel at all:
            no column, no response field, no update field. Reading one would be
            reading `undefined` and pretending otherwise, which is what the position
            readout used to do.

            One mechanism covers both readings of this feature — an image here is a
            sponsor logo if that is what it is, and the creator's own mark if that is
            what it is — which is also why it needs no backend change. */}
        <PanelSection
          title="Sponsor or second logo"
          hint="An optional second mark in the opposite corner. Use a sponsor's logo, or your own second mark."
        >
          {sponsorClip ? (
            <div className="flex items-center gap-3">
              <div className="h-10 w-20 shrink-0 overflow-hidden rounded-[#2c3235] bg-[#0d1014]">
                {sponsorClip.url ? (
                  <img src={sponsorClip.url} alt="" className="h-full w-full object-contain" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-[#d8d9da]">{sponsorClip.mediaName}</p>
                <p className="text-[11px] text-[#9fa7b3]">
                  {sponsorClip.transform.corner?.replace('-', ' ')} ·{' '}
                  {Math.round(sponsorClip.transform.pipSize * 100)}% wide
                </p>
              </div>
              <Button onClick={() => onRemoveSponsor(sponsorClip.id)} variant="danger">
                <Trash2 className="mr-1.5 h-2.5 w-2.5" />
                Remove
              </Button>
            </div>
          ) : (
            <>
              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full">
                <ImageIcon className="mr-1.5 h-2.5 w-2.5" />
                Choose an image
              </Button>
              {/* Kept mounted and hidden rather than created per click: an input
                  created on demand is discarded before its change event finishes
                  firing in some browsers, and the file silently never arrives. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Choose a sponsor or second logo"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset first: picking the same file twice in a row must fire again.
                  e.target.value = '';
                  if (file) onAddSponsor(file);
                }}
              />
              <p className="mt-2 text-[11px] text-[#9fa7b3]">
                Sits in the bottom-right corner. Optional — leave it empty and only your channel
                logo appears.
              </p>
            </>
          )}
        </PanelSection>

        {message && (
          <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}

        {brandingTrack && existingClip && (
          <PanelSection title="Logo Opacity" hint="Adjust how prominent the logo appears on your videos.">
            <Field label="Opacity">
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round((existingClip.opacity ?? 1) * 100)}
                onChange={(e) => {
                  const opacity = parseInt(e.target.value) / 100;
                  onUpdateClip(existingClip.id, { opacity });
                }}
                className="w-full accent-pink-500"
              />
            </Field>
            <p className="text-xs text-[#9fa7b3]">
              {Math.round((existingClip.opacity ?? 1) * 100)}% — lower for subtle watermarking
            </p>
          </PanelSection>
        )}

        {brandingTrack && !existingClip && selectedChannelId && (
          <p className="text-xs text-[#9fa7b3]">
            The branding track is ready. Select a channel above to add its logo.
          </p>
        )}
      </PanelSection>

      <PanelSection title="About the Branding Track" hint="How it works">
        <ul className="space-y-1.5 text-xs text-[#9fa7b3]">
          <li className="flex items-start gap-1.5">
            <Badge className="mt-0.5 h-2.5 w-2.5 shrink-0 text-pink-400" />
            <span>The branding track is <strong>locked</strong> and cannot be deleted or reordered.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <Sparkles className="mt-0.5 h-2.5 w-2.5 shrink-0 text-pink-400" />
            <span>Logo <strong>auto-applies</strong> when you select a channel — zero clicks after setup.</span>
          </li>
          <li className="flex items-start gap-1.5">
            <ImageIcon className="mt-0.5 h-2.5 w-2.5 shrink-0 text-pink-400" />
            <span>Position and sizing come from <strong>channel setup</strong> (logo position, auto-size).</span>
          </li>
          <li className="flex items-start gap-1.5">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-pink-400/20" />
            <span>Opacity slider above controls <strong>visibility</strong> without removing the logo.</span>
          </li>
        </ul>
      </PanelSection>
    </div>
  );
}
