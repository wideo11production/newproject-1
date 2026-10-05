'use client';

// =============================================================================
// CHANNEL SETUP - STEP 2
// =============================================================================
//
// Step 2 of channel creation: giving the channel its identity and its defaults.
//
// =============================================================================
// WHY THIS IS A SEPARATE SCREEN AND NOT A SECOND TAB ON THE DASHBOARD
// =============================================================================
//
// Because the requirement is that step 2 is COMPULSARY. A dashboard is a place
// you arrive; a wizard is a place you pass through. Making step 2 an optional tab
// means it is never finished, and an unfinished channel is exactly the state this
// whole step exists to remove - an empty banner slot, no logo, no colour, no
// upload defaults. That is what every abandoned account looks like.
//
// A route also means the URL is shareable and reloadable. A modal loses both, and
// "my logo vanished when I reloaded" is a bug report that arrives for free.
//
// =============================================================================
// WHY IT CANNOT DEADLOCK, GIVEN THAT IT IS COMPULSORY
// =============================================================================
//
// A compulsory screen is only safe if every answer is skippable. Checked:
//
//   logo          optional - the field is genuinely optional, no default needed
//   tagline       optional, empty is valid
//   brand colour  optional - "platform default" is a real, choosable answer
//   category      ALREADY ANSWERED in step 1, shown for confirmation, pre-filled
//   keywords      optional, empty is valid
//   visibility    optional - defaults to Public
//   comments      optional - defaults to on, "anyone"
//
// There is no required field on this screen. So there is no combination of
// answers that leaves a creator stuck, and the Finish button is never disabled.
// A gate that can trap somebody is a gate that eventually traps somebody.
//
// =============================================================================
// WHAT IS NOT ASKED HERE, AND WHY
// =============================================================================
//
//   Email       already collected at registration
//   Password    security setup, a separate flow with its own reasons
//   Billing     entitlements decide that, not the creator
//   Cover       done in step 1, and editable here via the shared uploader
//
// Asking again what another flow already owns is how a user ends up with two
// different answers in two places and neither one being wrong on its own page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Palette, Sparkles, Tag, Eye, MessageSquare, Baby, Droplets, MousePointer, Maximize2, Minimize2 } from 'lucide-react';
import { Label } from '@wideo11/ui/label';
import { Input } from '@wideo11/ui/input';
import { CoverUploader } from '@/components/channels/cover-uploader';
import { uploadChannelLogo } from '@/lib/channel-logo-upload';
import { CHANNEL_TYPES, type ChannelType } from '@/lib/channel-types';

/** The palette entry the server sent, plus how to paint it. */
type BrandColor = {
  name: string;
  hue: number;
  saturation: number;
  lightness: number;
};

type SetupChannel = {
  id: string;
  handle: string;
  display_name: string;
  tagline: string;
  cover_url: string;
  logo_url: string;
  /** null means "use the platform default". */
  brand_hue: number | null;
  brand: BrandColor;
  visibility: string;
  channel_type?: string;
  keywords?: string;
  comments_enabled: boolean;
  comment_policy: string;
  kids_auto_classify: boolean;
  watermark_enabled: boolean;
  /** Logo position: corner of the frame. */
  logo_position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Auto-size logo to fit the corner. */
  logo_auto_size?: boolean;
  setup_complete: boolean;
  setup_completed_at?: string;
};

/** The bytes a hue maps to, as an HSL triple. */
function hsl(c: BrandColor) {
  return `hsl(${c.hue} ${c.saturation}% ${c.lightness}%)`;
}

/** Same hue, forced dark and light, so a swatch reads on either theme. */
function swatchStyle(c: BrandColor) {
  return { backgroundColor: `hsl(${c.hue} ${c.saturation}% 50%)` };
}

const VISIBILITIES: { value: string; label: string; blurb: string }[] = [
  {
    value: 'public',
    label: 'Public',
    blurb: 'Anyone can find it, and it shows up in browse and search.',
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    blurb: 'Anyone with the link can watch. It appears nowhere in browse or search.',
  },
  {
    value: 'private',
    label: 'Private',
    blurb: 'Only you. Not shareable, not listed, not linkable.',
  },
];

const COMMENT_POLICIES: { value: string; label: string; blurb: string }[] = [
  { value: 'anyone', label: 'Anyone', blurb: 'Signed-in viewers can comment.' },
  { value: 'subscribers', label: 'Subscribers', blurb: 'Only people subscribed to you.' },
  { value: 'approved', label: 'Approved', blurb: 'Every comment waits for you to allow it.' },
];

export default function ChannelSetupPage() {
  const router = useRouter();

  const [channelId, setChannelId] = useState<string | null>(null);
  const [state, setState] = useState<SetupChannel | null>(null);
  const [palette, setPalette] = useState<BrandColor[]>([]);
  const [maxLogoBytes, setMaxLogoBytes] = useState(2 * 1024 * 1024);

  // Answers, held separately from `state` so typing does not fight the fetch.
  const [tagline, setTagline] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [brandHue, setBrandHue] = useState<number | null>(null);
  const [visibility, setVisibility] = useState('public');
  const [channelType, setChannelType] = useState<string>('');
  const [keywords, setKeywords] = useState('');
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [commentPolicy, setCommentPolicy] = useState('anyone');
  const [kidsAutoClassify, setKidsAutoClassify] = useState(true);
  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [logoPosition, setLogoPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right');
  const [logoAutoSize, setLogoAutoSize] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const [saveOk, setSaveOk] = useState('');
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoProgress, setLogoProgress] = useState(0);
  const [logoErr, setLogoErr] = useState('');
  const logoInput = useRef<HTMLInputElement | null>(null);

  // ======================================================================
  // Which channel?
  // ======================================================================
  //
  // The SERVER decides. `/channels/setup/pending` answers with the newest
  // unfinished channel, computed from `setup_step2_at`.
  //
  // Reading the channel id out of the URL instead would be simpler and wrong: it
  // would let a creator land on step 2 for a channel they have already finished,
  // and - more to the point - it would make the gate a client decision. A gate the
  // client decides for itself is a gate the client can be talked out of, and this
  // one is compulsory.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const pendingRes = await fetch('/api/channels/setup/pending', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null);

      if (cancelled) return;

      if (!pendingRes) {
        // Could not ask. Do NOT silently continue to the dashboard - that is how a
        // compulsory step becomes an optional one through a single network blip.
        setSaveErr('Could not check whether setup is needed. Please retry.');
        return;
      }
      if (!pendingRes.needs_setup || !pendingRes.channel_id) {
        router.replace('/dashboard');
        return;
      }

      setChannelId(pendingRes.channel_id);

      const setupRes = await fetch(`/api/channels/${pendingRes.channel_id}/setup`, {
        cache: 'no-store',
      }).then((r) => r.json());

      if (cancelled) return;
      if (!setupRes?.channel) {
        setSaveErr('Could not load this channel. Please retry.');
        return;
      }

      const ch = setupRes.channel as SetupChannel;
      setState(ch);
      setTagline(ch.tagline ?? '');
      setLogoUrl(ch.logo_url ?? '');
      setBrandHue(ch.brand_hue ?? null);
      setVisibility(ch.visibility ?? 'public');
      setChannelType(ch.channel_type ?? '');
      setKeywords(ch.keywords ?? '');
      setCommentsEnabled(ch.comments_enabled ?? true);
      setCommentPolicy(ch.comment_policy ?? 'anyone');
      setKidsAutoClassify(ch.kids_auto_classify ?? true);
      setWatermarkEnabled(ch.watermark_enabled ?? false);
      setLogoPosition(ch.logo_position ?? 'bottom-right');
      setLogoAutoSize(ch.logo_auto_size ?? true);
      if (Array.isArray(setupRes.brand_colors)) setPalette(setupRes.brand_colors);
      if (typeof setupRes.max_logo_bytes === 'number') setMaxLogoBytes(setupRes.max_logo_bytes);
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /**
   * Save one section.
   *
   * PATCH with only the fields that changed, because every field on the server is
   * a pointer: "not sent" and "sent false" must stay distinguishable, or saving
   * the tagline would silently clear the keywords.
   */
  const save = useCallback(
    async (patch: Record<string, unknown>, quiet = false) => {
      if (!channelId) return false;
      if (!quiet) {
        setSaving(true);
        setSaveErr('');
        setSaveOk('');
      }
      try {
        const res = await fetch(`/api/channels/${channelId}/setup`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSaveErr(data.message ?? data.error ?? 'Could not save.');
          return false;
        }
        if (data.channel) setState(data.channel as SetupChannel);
        setSaveOk('Saved.');
        return true;
      } catch {
        setSaveErr('Network error. Please try again.');
        return false;
      } finally {
        if (!quiet) setSaving(false);
      }
    },
    [channelId]
  );

  // ---- Save-on-blur, per section ----
  //
  // Saving on blur rather than on every keystroke: a creator typing a tagline would
  // otherwise generate a PATCH per character, and each one is a database write.
  // Blur means "they moved on", which is the moment the answer is worth keeping.
  //
  // ---- WHY THE PENDING PATCH IS FLUSHED RATHER THAN CANCELLED ----
  //
  // The first version debounced with ONE timer:
  //
  //     if (blurTimer.current) clearTimeout(blurTimer.current);
  //     blurTimer.current = setTimeout(() => save(patch, true), 350);
  //
  // A single timer for the whole screen means the second field to be edited
  // CANCELS the first field's pending save. Fill the tagline, tab to keywords, tab
  // away: the tagline was never sent, and the creator watched them type it into a
  // field that then saved something else.
  //
  // It is silent, it is data loss, and it is invisible to a check that only ever
  // fills ONE field - which is how it survived to the point where the browser check
  // found it.
  //
  // So the pending patch is a REF, and blurring a new field FLUSHES the old one
  // before scheduling the new. Nothing is ever dropped; the debounce still coalesces
  // keystrokes within one field, because only the most recent blur for that field
  // is pending at a time.
  const pendingPatch = useRef<Record<string, unknown> | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPending = useCallback(() => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    if (pendingPatch.current) {
      const patch = pendingPatch.current;
      pendingPatch.current = null;
      void save(patch, true);
    }
  }, [save]);

  function saveOnBlur(patch: Record<string, unknown>) {
    // Flush whatever was waiting BEFORE replacing it. Order is the whole point.
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    if (pendingPatch.current) void save(pendingPatch.current, true);
    pendingPatch.current = patch;
    blurTimer.current = setTimeout(flushPending, 350);
  }

  // Unmounting with a pending patch would lose it. React does not run blur on
  // unmount, so navigation is the one path blur never sees.
  useEffect(() => flushPending, [flushPending]);

  // ---- Logo ----
  async function pickLogo(file: File) {
    if (!channelId) return;
    setLogoBusy(true);
    setLogoErr('');
    setLogoProgress(0);
    try {
      const publicUrl = await uploadChannelLogo({
        channelId,
        file,
        maxBytes: maxLogoBytes,
        onProgress: setLogoProgress,
      });
      setLogoUrl(publicUrl);
    } catch (e) {
      setLogoErr(e instanceof Error ? e.message : 'Upload failed. Please try again.');
    } finally {
      setLogoBusy(false);
    }
  }

  // ---- Finish ----
  async function finish() {
    if (!channelId) return;
    setSaving(true);
    setSaveErr('');
    setSaveOk('');
    try {
      const res = await fetch(`/api/channels/${channelId}/setup`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The whole object, plus the flag. Sending everything here rather than a
        // patch is deliberate: this is the last save, and leaving anything behind
        // would mean the dashboard shows one state and the channel has another.
        body: JSON.stringify({
          tagline: tagline.trim(),
          logo_url: logoUrl,
          brand_hue: brandHue,
          brand_hue_is_null: brandHue === null,
          visibility,
          channel_type: channelType || undefined,
          keywords,
          comments_enabled: commentsEnabled,
          comment_policy: commentsEnabled ? commentPolicy : 'approved',
          kids_auto_classify: kidsAutoClassify,
          watermark_enabled: watermarkEnabled,
          logo_position: logoPosition,
          logo_auto_size: logoAutoSize,
          finish_step2: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveErr(data.message ?? data.error ?? 'Could not finish setup.');
        return;
      }
      router.push('/dashboard');
    } catch {
      setSaveErr('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ---- Loading / error / redirecting ----
  if (!state) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-sm text-[#9fa7b3]">
        {saveErr || 'Loading channel setup…'}
      </main>
    );
  }

  // The effective colour, whether the creator chose one or not.
  const activeBrand =
    palette.find((c) => c.hue === brandHue) ??
    palette.find((c) => c.hue === state.brand.hue) ??
    state.brand;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 pb-28">
      {/* ---- Header ---- */}
      <header className="mb-6">
        <button
          type="button"
          data-track="setup-back"
          onClick={() => router.push('/dashboard')}
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-[#9fa7b3] hover:text-[#d8d9da]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to dashboard
        </button>
        <h1 className="text-lg font-semibold text-[#d8d9da]">Set up your channel</h1>
        <p className="mt-1 text-xs text-[#9fa7b3]">
          Step 2 of 2. Everything here is optional and you can change it later — but a
          channel with a logo and a colour looks like somebody made it.
        </p>
      </header>

      {/* ---- Preview ----
          The live preview is the point. A colour swatch teaches nothing about a
          colour; the banner with the colour actually on it does. */}
      <div className="mb-6 overflow-hidden rounded-lg border border-[#2c3235]">
        <div
          className="relative h-28 w-full"
          style={{
            backgroundImage: state.cover_url ? `url(${state.cover_url})` : undefined,
            backgroundColor: hsl(activeBrand),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!state.cover_url ? (
            <span className="flex h-full w-full items-center justify-center text-[10px] text-white/60">
              No cover yet — you can add one below
            </span>
          ) : null}
          {/* Logo position preview - shows where the logo will sit on videos */}
          {logoUrl && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                display: 'flex',
                alignItems: logoPosition.startsWith('top') ? 'flex-start' : 'flex-end',
                justifyContent: logoPosition.endsWith('left') ? 'flex-start' : 'flex-end',
                padding: '8px',
              }}
            >
              <div
                className="overflow-hidden rounded-full border-2 opacity-80"
                style={{
                  borderColor: hsl(activeBrand),
                  backgroundColor: '#101216',
                  width: logoAutoSize ? '48px' : '48px',
                  height: logoAutoSize ? '48px' : '48px',
                }}
              >
                <img src={logoUrl} alt="" className="h-full w-full object-cover" />
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-[#2c3235] bg-[#181b1f] px-4 py-3">
          <div
            className="h-11 w-11 shrink-0 overflow-hidden rounded-full border-2"
            style={{ borderColor: hsl(activeBrand), backgroundColor: '#101216' }}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[11px] font-bold text-[#9fa7b3]">
                {(state.display_name || '?').slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-[#d8d9da]">{state.display_name}</p>
            <p className="truncate text-[11px] text-[#9fa7b3]">
              {tagline || '@' + state.handle}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* ---- Logo ---- */}
        <Section
          icon={<Sparkles className="h-3.5 w-3.5" />}
          title="Channel logo"
          hint="The square mark beside your name, on every card and list."
          dataTrack="setup-section-logo"
        >
          <div className="flex items-center gap-3">
            <div
              className="h-16 w-16 shrink-0 overflow-hidden rounded-full border"
              style={{ borderColor: hsl(activeBrand), backgroundColor: '#101216' }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="space-y-1.5">
              {/*
                `id` IS NOT OPTIONAL HERE. It is what the `<label htmlFor>` below
                points at, and it is the ONLY thing that opens the file dialog when
                somebody clicks the button.

                The input originally had `data-track="setup-logo-input"` and NO
                `id`, so `htmlFor="setup-logo-input"` matched nothing and the Upload
                button did nothing at all. Reported as "the upload button does not
                work, everything else does" - which is exactly right, and exactly
                why it is worth spelling out.

                WHY IT SURVIVED A CHECK THAT UPLOADED A REAL FILE AND PASSED:
                `tools/check-channel-setup.mjs` pushes a real PNG through this input
                with CDP's `DOM.setFileInputFiles`, which sets the file on the
                element DIRECTLY and never goes near the label. So the upload
                pipeline was proven to work end to end, the button was proven broken,
                and the check reported 40/40.

                A check that exercises the plumbing but not the door. The fix is
                below in the test as well as here: assert the file CHOOSER opens when
                the button is clicked, which is the claim the user is actually
                making.
              */}
              <input
                ref={logoInput}
                id="setup-logo-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-track="setup-logo-input"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickLogo(f);
                  // Same file twice must fire again.
                  e.target.value = '';
                }}
              />
              <label
                htmlFor="setup-logo-input"
                data-track="setup-logo-button"
                className={`inline-flex h-8 cursor-pointer items-center rounded-md border border-[#2c3235] px-2.5 text-[11px] text-[#d8d9da] hover:bg-[#1f2227] ${
                  logoBusy ? 'pointer-events-none opacity-50' : ''
                }`}
              >
                {logoBusy ? `Uploading ${logoProgress}%…` : logoUrl ? 'Replace' : 'Upload logo'}
              </label>
              <p className="text-[10px] text-[#6b7280]">
                PNG, JPEG or WebP. Under {Math.round(maxLogoBytes / 1024 / 1024)} MB. Stored
                on your own server.
              </p>
              {logoErr ? <p className="text-[10px] text-red-400">{logoErr}</p> : null}
            </div>
          </div>
        </Section>

        {/* ---- Logo position & auto-size ----
            Only relevant if a logo exists. Shown conditionally so a creator without
            a logo isn't asked to position something they don't have. */}
        {logoUrl && (
          <Section
            icon={<MousePointer className="h-3.5 w-3.5" />}
            title="Logo position"
            hint="Where your logo sits on every video."
            dataTrack="setup-section-logo-position"
          >
            <div className="space-y-3">
              <Label className="text-xs text-[#9fa7b3]">Corner</Label>
              <div className="grid grid-cols-2 gap-2">
                {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    data-track={`setup-logo-pos-${pos}`}
                    aria-pressed={logoPosition === pos}
                    onClick={() => {
                      setLogoPosition(pos);
                      void save({ logo_position: pos });
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                      logoPosition === pos
                        ? 'border-[#5794f2]/50 bg-[#5794f2]/5 text-[#d8d9da]'
                        : 'border-[#2c3235] hover:bg-[#1f2227] text-[#9fa7b3]'
                    }`}
                  >
                    <span className="h-2 w-2 rounded" style={{
                      background: logoPosition === pos ? '#5794f2' : 'transparent',
                      border: '1px solid currentColor'
                    }} />
                    <span className="text-[11px] font-medium">{pos.replace('-', ' ')}</span>
                  </button>
                ))}
              </div>

              <Label className="text-xs text-[#9fa7b3]">Sizing</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-track="setup-logo-auto-size-on"
                  aria-pressed={logoAutoSize}
                  onClick={() => {
                    setLogoAutoSize(true);
                    void save({ logo_auto_size: true });
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    logoAutoSize
                      ? 'border-[#5794f2]/50 bg-[#5794f2]/5 text-[#d8d9da]'
                      : 'border-[#2c3235] hover:bg-[#1f2227] text-[#9fa7b3]'
                  }`}
                >
                  <Maximize2 className="h-3 w-3" />
                  <span className="text-[11px] font-medium">Auto-size</span>
                </button>
                <button
                  type="button"
                  data-track="setup-logo-auto-size-off"
                  aria-pressed={!logoAutoSize}
                  onClick={() => {
                    setLogoAutoSize(false);
                    void save({ logo_auto_size: false });
                  }}
                  className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                    !logoAutoSize
                      ? 'border-[#5794f2]/50 bg-[#5794f2]/5 text-[#d8d9da]'
                      : 'border-[#2c3235] hover:bg-[#1f2227] text-[#9fa7b3]'
                  }`}
                >
                  <Minimize2 className="h-3 w-3" />
                  <span className="text-[11px] font-medium">Manual</span>
                </button>
              </div>
              <p className="text-[10px] text-[#6b7280]">
                Auto-size fits the logo to the corner at a consistent scale across
                all project aspect ratios. Manual lets you set a custom size in the
                editor.
              </p>
            </div>
          </Section>
        )}

        {/* ---- Tagline ---- */}
        <Section
          icon={<Tag className="h-3.5 w-3.5" />}
          title="Tagline"
          hint="One line under your channel name."
          dataTrack="setup-section-tagline"
        >
          <Input
            value={tagline}
            data-track="setup-tagline"
            maxLength={120}
            placeholder="Baking, badly but honestly"
            onChange={(e) => setTagline(e.target.value)}
            onBlur={() => saveOnBlur({ tagline: tagline.trim() })}
          />
          <p className="mt-1 text-[10px] text-[#6b7280]">{tagline.length}/120</p>
        </Section>

        {/* ---- Brand colour ----
            The swatches are rendered from the palette the SERVER sent, not from a
            local copy. The set of colours is a reviewed decision with a contrast
            guarantee behind it, and a client-side copy would be free to grow a
            colour nobody checked. */}
        <Section
          icon={<Palette className="h-3.5 w-3.5" />}
          title="Brand colour"
          hint="Used for your logo ring, buttons and highlights."
          dataTrack="setup-section-brand"
        >
          <div className="flex flex-wrap gap-2">
            {palette.map((c) => {
              const selected = brandHue === c.hue;
              return (
                <button
                  key={c.hue}
                  type="button"
                  data-track={`setup-brand-${c.name}`}
                  aria-pressed={selected}
                  title={c.name}
                  onClick={() => {
                    setBrandHue(c.hue);
                    void save({ brand_hue: c.hue, brand_hue_is_null: false });
                  }}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    selected ? 'scale-110 border-[#d8d9da]' : 'border-transparent'
                  }`}
                  style={swatchStyle(c)}
                />
              );
            })}
          </div>
          <button
            type="button"
            data-track="setup-brand-default"
            onClick={() => {
              setBrandHue(null);
              // `brand_hue_is_null` is what distinguishes "clear this" from
              // "leave it alone". Without it the server cannot tell hue 0 from no
              // answer, and red becomes impossible to select.
              void save({ brand_hue: null, brand_hue_is_null: true });
            }}
            className={`mt-2 text-[10px] underline-offset-2 hover:underline ${
              brandHue === null ? 'text-[#d8d9da]' : 'text-[#6b7280]'
            }`}
          >
            Use the platform default
          </button>
        </Section>

        {/* ---- Category + keywords ----
            Category was already answered in step 1. It is shown for confirmation
            rather than re-asked, because a wrong category picks the wrong upload
            defaults and a creator who cannot see their own answer cannot tell that
            it is wrong. */}
        <Section
          icon={<Sparkles className="h-3.5 w-3.5" />}
          title="Category and keywords"
          hint="These decide which uploads get recommended where."
          dataTrack="setup-section-discovery"
        >
          <Label className="text-xs text-[#9fa7b3]">Category</Label>
          <select
            value={channelType}
            data-track="setup-channel-type"
            onChange={(e) => {
              setChannelType(e.target.value);
              void save({ channel_type: e.target.value });
            }}
            className="mt-1 h-9 w-full rounded-md border border-[#2c3235] bg-[#101216] px-2 text-xs text-[#d8d9da]"
          >
            <option value="">Choose a category</option>
            {CHANNEL_TYPES.map((t: ChannelType) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          <Label className="mt-3 block text-xs text-[#9fa7b3]">Keywords</Label>
          <Input
            value={keywords}
            data-track="setup-keywords"
            placeholder="baking, sourdough, bread"
            onChange={(e) => setKeywords(e.target.value)}
            onBlur={() => saveOnBlur({ keywords })}
          />
          <p className="mt-1 text-[10px] text-[#6b7280]">
            Comma separated. Keywords help people find you — they are not read by
            anyone, so keep them honest.
          </p>
        </Section>

        {/* ---- Visibility ----
            Three states, and "Unlisted" is the one that matters most: it is what a
            creator wants for a first upload, and a boolean would have forced a
            choice between "the whole world" and "nobody". */}
        <Section
          icon={<Eye className="h-3.5 w-3.5" />}
          title="Who can see it"
          hint="You can change this at any time."
          dataTrack="setup-section-visibility"
        >
          <div className="space-y-2">
            {VISIBILITIES.map((v) => {
              const selected = visibility === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  data-track={`setup-visibility-${v.value}`}
                  aria-pressed={selected}
                  onClick={() => {
                    setVisibility(v.value);
                    void save({ visibility: v.value });
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors ${
                    selected
                      ? 'border-[#5794f2]/50 bg-[#5794f2]/5'
                      : 'border-[#2c3235] hover:bg-[#1f2227]'
                  }`}
                >
                  <span
                    className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 ${
                      selected ? 'border-[#5794f2]' : 'border-[#4b5158]'
                    }`}
                  />
                  <span>
                    <span className="block text-xs font-medium text-[#d8d9da]">{v.label}</span>
                    <span className="block text-[10px] text-[#9fa7b3]">{v.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* ---- Upload defaults ----
            Per channel, not per account. A creator with two channels legitimately
            wants comments off on one and required on the other, and a single global
            setting cannot say that. */}
        <Section
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          title="Default upload settings"
          hint="Applied to new uploads on this channel. You can change any of it per video."
          dataTrack="setup-section-uploads"
        >
          <Toggle
            label="Comments"
            hint="Turn off to close comments on every upload by default."
            checked={commentsEnabled}
            dataTrack="setup-comments-enabled"
            onChange={(v) => {
              setCommentsEnabled(v);
              void save({
                comments_enabled: v,
                // Resolved server-side too, but sent here so the two never
                // disagree: comments off with the policy still "anyone" is a
                // contradiction two readers would answer differently.
                comment_policy: v ? commentPolicy : 'approved',
              });
            }}
          />

          {commentsEnabled ? (
            <div className="mt-3 space-y-2">
              {COMMENT_POLICIES.map((p) => {
                const selected = commentPolicy === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    data-track={`setup-comment-policy-${p.value}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setCommentPolicy(p.value);
                      void save({ comment_policy: p.value });
                    }}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                      selected
                        ? 'border-[#5794f2]/50 bg-[#5794f2]/5'
                        : 'border-[#2c3235] hover:bg-[#1f2227]'
                    }`}
                  >
                    <span className="text-[11px] font-medium text-[#d8d9da]">{p.label}</span>
                    <span className="text-[10px] text-[#9fa7b3]">{p.blurb}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <Toggle
            label="Auto-classify uploads"
            hint="Apply the made-for-kids setting to every upload automatically."
            icon={<Baby className="h-3.5 w-3.5" />}
            checked={kidsAutoClassify}
            dataTrack="setup-kids-auto"
            onChange={(v) => {
              setKidsAutoClassify(v);
              void save({ kids_auto_classify: v });
            }}
          />

          <Toggle
            label="Brand watermark"
            hint="Stamp your colour on exported files."
            icon={<Droplets className="h-3.5 w-3.5" />}
            checked={watermarkEnabled}
            dataTrack="setup-watermark"
            onChange={(v) => {
              setWatermarkEnabled(v);
              void save({ watermark_enabled: v });
            }}
          />
        </Section>

        {/* ---- Cover, editable here ----
            Already uploaded in step 1. Offered again because a creator who skipped
            it there may now have something they want, and hunting for another
            settings page to find the same uploader is how a channel stays blank. */}
        <Section
          icon={<Sparkles className="h-3.5 w-3.5" />}
          title="Cover image"
          hint="The wide banner at the top of your channel page."
          dataTrack="setup-section-cover"
        >
          <CoverUploader
            channelId={state.id}
            currentUrl={state.cover_url}
            onUploaded={async (url) => {
              // Refresh from the server rather than assuming: finalize wrote the
              // column, and trusting the local value means the preview and the
              // database can disagree for as long as this page stays open.
              const res = await fetch(`/api/channels/${state.id}/setup`, {
                cache: 'no-store',
              }).then((r) => r.json());
              if (res?.channel) {
                setState(res.channel as SetupChannel);
                setSaveOk('Cover updated.');
              }
            }}
          />
        </Section>
      </div>

      {/* ---- Save status ---- */}
      <div className="mt-6 min-h-[20px] text-[11px]">
        {saving ? <span className="text-[#9fa7b3]">Saving…</span> : null}
        {saveErr ? <span className="text-red-400">{saveErr}</span> : null}
        {saveOk ? <span className="text-[#9fa7b3]">{saveOk}</span> : null}
      </div>

      {/* ---- Finish ----
          Fixed to the bottom so it is reachable without scrolling past six
          sections on a phone. Never disabled: there is no required field on this
          screen, so there is nothing to be waiting for. A compulsory step whose
          button can be disabled is a step that can trap somebody. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-[#2c3235] bg-[#0d0f11]/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <p className="text-[10px] text-[#6b7280]">
            You can change all of this later.
          </p>
          <button
            type="button"
            data-track="setup-finish"
            disabled={saving}
            onClick={() => void finish()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#5794f2] px-4 text-xs font-medium text-white transition-colors hover:bg-[#4a84db] disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? 'Finishing…' : 'Finish setup'}
          </button>
        </div>
      </div>
    </main>
  );
}

/** One titled block. */
function Section({
  icon,
  title,
  hint,
  dataTrack,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  dataTrack?: string;
  children: React.ReactNode;
}) {
  return (
    <section data-track={dataTrack} className="rounded-lg border border-[#2c3235] p-4">
      <div className="mb-3 flex items-start gap-2">
        <span className="mt-0.5 text-[#5794f2]">{icon}</span>
        <div>
          <h2 className="text-xs font-medium text-[#d8d9da]">{title}</h2>
          {hint ? <p className="mt-0.5 text-[10px] text-[#9fa7b3]">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * A labelled on/off switch.
 *
 * A real checkbox rather than a div with onClick, so it is reachable by keyboard
 * and announced correctly. A custom control that is only a click target is
 * invisible to anyone not using a mouse.
 */
function Toggle({
  label,
  hint,
  icon,
  checked,
  onChange,
  dataTrack,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  dataTrack?: string;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        data-track={dataTrack}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#5794f2]"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#d8d9da]">
          {icon}
          {label}
        </span>
        {hint ? <span className="mt-0.5 block text-[10px] text-[#9fa7b3]">{hint}</span> : null}
      </span>
    </label>
  );
}
