'use client';

// ============================================================================
// CREATOR DASHBOARD  -  /dashboard
// ============================================================================
//
// Ye pehle wala `DashboardEditor` (panels + refresh interval) NAHI hai - wo
// ek admin/monitoring tool hai aur `/monitor` par rehne chahiye.
//
// Ye page CREATOR ka home hai:
//   1. PROFILE     - avatar (change kar sakte hain) + username + email
//   2. CHANNELS    - user ke apne channels + "Create channel" form
//   3. DEVICES     - "aap kis device par logged in hain" (sessions/devices)
//
// SECURITY:
//   - Saara data same-origin proxy (`/api/*`) se aata hai, jo httpOnly cookie
//     se token attach karke auth-service tak pahunchata hai. Client ke paas
//     token KABHI nahi hota.
//   - Backend har query me `user_id` filter lagata hai (token se) - koi aur
//     user ka data access nahi ho sakta.
//
// THEME: dark Grafana palette (#111217 family) - `layout.tsx` par ab
// `<html class="dark">` set hai, to shadcn tokens bhi dark resolve hote hain
// (pehle ye page light dikhta tha).
//
// Hinglish comments: har block ka arth

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChannelWizardFields,
  clientPreflight,
  EMPTY_WIZARD,
  type ChannelWizardExtras,
} from '@/components/channels/channel-wizard-fields';
import { ChannelTermsDialog, TC_VERSION } from '@/components/channels/channel-terms-dialog';
import Link from 'next/link';
import { TrialCountdown } from '../../components/dashboard/trial-countdown';

/**
 * Where the video editor lives.
 *
 * The editor is a SEPARATE app on its own port, not a route in this one, so
 * this has to be an absolute URL. The default matches the published compose
 * port; an env var is here so a deployment does not have to edit source.
 */
const VIDEO_EDITOR_URL = process.env.NEXT_PUBLIC_VIDEO_EDITOR_URL ?? 'http://localhost:3002';
import {
  Camera,
  Check,
  Loader2,
  LogOut,
  Monitor,
  Plus,
  ShieldCheck,
  User,
  X,
  Youtube,
  Download,
  Settings,
  Compass,
  Upload,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
import { useSessionIdentity } from '@/lib/identity-context';
import { AvatarUploader } from '@/components/dashboard/avatar-uploader';
import { ChannelManager } from '@/components/channels/channel-manager';
import { DashboardSidebar } from '@/components/dashboard/dashboard-sidebar';
import { OverflowMenu, type MenuItem } from '@/components/dashboard/overflow-menu';
import { InstallPanel } from '@/components/dashboard/install-panel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Profile = {
  id: string;
  email: string;
  username: string;
  full_name: string;
  avatar_url: string;
  is_verified: boolean;
  created_at: string;
};

type Channel = {
  id: string;
  handle: string;
  display_name: string;
  description: string;
  image_url: string;
  cover_url: string;
  is_public: boolean;
  is_active: boolean;
  created_at: string;
};

type DeviceSession = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen: string;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * User-Agent string se readable device label nikaalta hai.
 *
 * Ye sirf DISPLAY ke liye hai - authorization ka basis nahi. UA header
 * client-controlled hai (spoof ho sakta hai), isliye ise kabhi trust na karein.
 */
function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const s = ua.toLowerCase();
  const browser = s.includes('edg')
    ? 'Edge'
    : s.includes('chrome')
    ? 'Chrome'
    : s.includes('firefox')
    ? 'Firefox'
    : s.includes('safari')
    ? 'Safari'
    : 'Browser';
  const os = s.includes('windows')
    ? 'Windows'
    : s.includes('mac os')
    ? 'macOS'
    : s.includes('android')
    ? 'Android'
    : s.includes('iphone') || s.includes('ipad')
    ? 'iOS'
    : s.includes('linux')
    ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** Relative time - "2 minutes ago" */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString();
}

/** User initials - avatar na hone par fallback */
function initialsOf(profile: Profile | null): string {
  if (!profile) return '?';
  const src = profile.full_name?.trim() || profile.username || profile.email;
  return src.slice(0, 2).toUpperCase();
}

export default function CreatorDashboard() {
  const router = useRouter();

  // ---- Data ----
  const [profile, setProfile] = useState<Profile | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);

  // ======================================================================
  // THE COMPULSORY STEP-2 GATE
  // ======================================================================
  //
  // While a channel is unfinished, the dashboard sends the creator to step 2.
  //
  // ---- WHY THIS IS ASKED AND NOT DERIVED FROM `channels` ----
  //
  // The channel list already carries `cover_url` and the rest, so the obvious
  // implementation is "if the newest channel has no cover, redirect". That is
  // wrong in three ways at once:
  //
  //   1. It is a CLIENT decision about a COMPULSORY step. Whoever wants to skip it
  //      edits the request and skips it. The real rule is `setup_step2_at`, which
  //      the client cannot see or forge.
  //   2. It guesses what "finished" means. Step 2 is not "has a cover" - a creator
  //      may legitimately choose no cover, and that is a finished answer.
  //   3. It breaks the moment a channel is finished WITHOUT a cover. The channel is
  //      fine, and the guess redirects anyway, forever.
  //
  // So the question is asked of the server, and `channels` is left alone.
  //
  // ---- WHY `suppressGate` EXISTS, AND WHY IT IS NOT THE SAME AS BEING DONE ----
  //
  // Without it, arriving straight from step 2 would bounce back into it: step 2
  // finishes, pushes `/dashboard`, the gate re-asks, the server says "not
  // finished" (the save may not have landed yet), and the creator is trapped in a
  // loop they cannot leave.
  //
  // That is not hypothetical - it is the shape of every bug this repo has hit where
  // a gate re-evaluated before its own write became visible.
  //
  // So `suppressGate` is a TIMER, not a permission: it holds the gate off for a
  // few seconds after an explicit successful finish, and then the gate resumes
  // asking the server again. A creator who is not actually finished still gets
  // redirected; a creator who just finished does not get trapped. Nothing here can
  // make an unfinished channel look finished, because the gate goes back to asking
  // the server - it just waits a moment before asking.
  const [gateSuppressed, setGateSuppressed] = useState(false);
  const gateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skipGateBriefly = useCallback(() => {
    setGateSuppressed(true);
    if (gateTimer.current) clearTimeout(gateTimer.current);
    gateTimer.current = setTimeout(() => setGateSuppressed(false), 6000);
  }, []);

  useEffect(() => () => {
    if (gateTimer.current) clearTimeout(gateTimer.current);
  }, []);

  // ---- Avatar state ----
  const [avatarInput, setAvatarInput] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- Channel form state ----
  const [showChannelForm, setShowChannelForm] = useState(false);
  // The wizard answers the backend REQUIRES (migration 018). Without them the form
  // was unusable: the server replied `channel_type is required` and the UI had
  // nowhere to put it. Backend first, form second - that ordering shows.
  const [wizard, setWizard] = useState<ChannelWizardExtras>(EMPTY_WIZARD);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelErr, setChannelErr] = useState('');

  // ---- T&C gate state ----
  //
  // Two pieces, and they are not the same question:
  //
  //   tcDialogOpen - is the dialog on screen right now
  //   tcAccepted   - has the creator accepted the terms THIS session
  //
  // `tcAccepted` is per-session (not persisted to storage) ON PURPOSE: a
  // second channel is a second consent, and a stored "already accepted" flag
  // would make the third channel a click with no reading. The backend stores
  // the acceptance per channel row, which is the durable record.
  const [tcDialogOpen, setTcDialogOpen] = useState(false);
  const [tcAccepted, setTcAccepted] = useState(false);

  // The plan's channel ceiling, or null when it could not be resolved.
  //
  // null on failure DELIBERATELY: an unknown limit must not read as zero, or a
  // transient `/api/auth/my-plan` error would lock a creator out of creating a
  // channel they are entitled to. The server is the authority and still
  // enforces the cap; this is the early notice.
  const [channelLimit, setChannelLimit] = useState<number | null>(null);

  // ======================================================================
  // Data loading
  // ======================================================================
  const loadAll = useCallback(async () => {
    // `allSettled` taaki ek API fail ho to baaki ka data dikh jaaye
    // (partial failure = empty panel, na ki poora dashboard blank).
    const [p, c, s] = await Promise.allSettled([
      fetch('/api/profile', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/channels', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/sessions', { cache: 'no-store' }).then((r) => r.json()),
    ]);

    if (p.status === 'fulfilled' && p.value) {
      setProfile(p.value as Profile);
      setAvatarInput((prev) => prev || ((p.value as Profile).avatar_url ?? ''));
    }
    if (c.status === 'fulfilled' && c.value?.channels) {
      setChannels(c.value.channels as Channel[]);
    }
    if (s.status === 'fulfilled' && s.value?.sessions) {
      setDevices(s.value.sessions as DeviceSession[]);
    }
  }, []);

  // The plan's `max_channels`, fetched separately and awaited separately.
  //
  // NOT part of `loadAll`'s `allSettled`: a plan failure must not delay or
  // block the three panels above, and a channel-limit read that is slow is
  // one the creator can do without. `-1` is the server's "unlimited", so it
  // maps to null rather than to a number the comparison would misread.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/my-plan', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { limits?: Record<string, number | 'unlimited'> };
        const raw = body.limits?.max_channels;
        if (!alive) return;
        if (raw === 'unlimited') setChannelLimit(null);
        else if (typeof raw === 'number' && raw >= 0) setChannelLimit(raw);
      } catch {
        /* stays null - the create button remains enabled and the server still enforces */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // ======================================================================
  // The gate itself
  // ======================================================================
  //
  // Runs once the dashboard has its data, so the redirect does not race the
  // first paint and flash the whole page before bouncing.
  //
  // The failure case is the interesting one: if this request FAILS, the creator
  // is NOT redirected. A compulsory step must not be enforced by a network error -
  // if the check cannot be answered, the right behaviour is to let somebody
  // through and show them the dashboard, not to lock the page and hide why. The
  // step is still compulsory in the sense that matters: it cannot be skipped on
  // purpose.
  useEffect(() => {
    if (loading || gateSuppressed) return;
    let cancelled = false;

    (async () => {
      const res = await fetch('/api/channels/setup/pending', { cache: 'no-store' })
        .then((r) => r.json())
        .catch(() => null);

      if (cancelled || !res) return;
      if (res.needs_setup && res.channel_id) {
        router.replace('/dashboard/channels/setup');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, gateSuppressed, router]);

  // ======================================================================
  // Avatar save
  // ======================================================================
  // Avatar save karo. `boolean` return karta hai taaki caller (B2.4 sync)
  // decide kar sake ki identity refresh karna hai ya nahi.
  async function saveAvatarTo(url: string): Promise<boolean> {
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvatarMsg({
          ok: false,
          text: data.message ?? data.error ?? 'Could not save avatar.',
        });
        return false;
      }
      setAvatarMsg({ ok: true, text: 'Profile image updated.' });
      await loadAll();
      return true;
    } catch {
      setAvatarMsg({ ok: false, text: 'Network error. Please try again.' });
      return false;
    } finally {
      setAvatarBusy(false);
    }
  }

  // ======================================================================
  // Create channel
  // ======================================================================
  //
  // TWO STEPS: validate, then T&C, then submit.
  //
  // The T&C dialog sits between the button press and the API call because it
  // is a LEGAL gate, not a form field. Every channel — free or paid — requires
  // the creator's explicit acceptance, and the backend enforces it with
  // `ErrTCNotAccepted` (see `internal/service/creator.go`). Opening it after
  // the cheap validations pass means nobody reads the terms only to be told
  // their handle is malformed.
  function createChannel(e: React.FormEvent) {
    e.preventDefault();
    setChannelErr('');
    // Client-side format check (UX). Backend bhi SAME rule validate karta hai
    // (aur DB constraint bhi) - teen jagah ek jaisa rule.
    if (!/^[a-z0-9._-]{3,30}$/.test(handle.trim().toLowerCase())) {
      setChannelErr('Handle must be 3-30 characters: a-z, 0-9, _ . or -');
      return;
    }

    // ---- The two COMPLIANCE questions must be answered before submit ----
    //
    // `mature_content` and `made_for_kids` are required by the API
    // (`ErrMatureContentRequired`, `ErrMadeForKidsRequired`) and both default to
    // empty in `EMPTY_WIZARD` — deliberately, because defaulting a legal
    // classification would be the product asserting something the creator never said.
    //
    // So the field cannot be defaulted and the form cannot be submitted empty, which
    // means the CREATOR has to be asked. That is the correct resolution of the two
    // constraints, and it is why this is a client-side gate with a specific message
    // rather than a server error the creator cannot act on:
    //
    //     "pick the kind of channel this is"
    //     "answer yes, no, or audience"
    //
    // were both reaching a first-time creator who had never been told the fields
    // existed. `channel_type` is NOT checked here because it defaults to `other`,
    // which is a real answer rather than a missing one.
    if (!wizard.matureContent) {
      setChannelErr(
        'Answer the content rating question — "no", "yes" or "audience". It is required, and we will not pick it for you.'
      );
      return;
    }
    if (wizard.madeForKids === null) {
      setChannelErr(
        'Answer whether this channel is made for kids. It is a legal classification, separate from the content rating.'
      );
      return;
    }
    if (!displayName.trim()) {
      setChannelErr('Give your channel a display name.');
      return;
    }

    // The three REQUIRED wizard answers, each with its own message. `channel_type`
    // arrived as a 400 from the server and the form had nowhere to put it - the
    // backend required a field the UI did not have, so the form was unusable
    // rather than merely incomplete.
    const preflight = clientPreflight(wizard);
    if (preflight) {
      setChannelErr(preflight);
      return;
    }

    // ---- T&C gate ----
    //
    // Ab form valid hai, toh ab T&C dikhao. Agar already accept nahi hua hai
    // (dialog se aaya hai) toh dialog kholo; dialog se accept hone ke baad
    // `submitChannelWithTerms` directly chalta hai.
    if (!tcAccepted) {
      setTcDialogOpen(true);
      return;
    }

    void submitChannelWithTerms();
  }

  /** The API call, separated so the T&C dialog can call it on accept. */
  async function submitChannelWithTerms() {
    setChannelBusy(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim().toLowerCase(),
          display_name: displayName.trim(),
          description: description.trim(),
          channel_type: wizard.channelType,
          mature_content: wizard.matureContent,
          // Sent as null when unanswered, never as a bare `false`. An omitted
          // boolean would decode to false, which is an assertion about somebody's
          // content that nobody made.
          made_for_kids: wizard.madeForKids,
          contact_email: wizard.contactEmail.trim(),
          country: wizard.country.trim(),
          primary_language: wizard.primaryLanguage.trim(),
          keywords: wizard.keywords.trim(),
          // Only sent when an upload actually finished. Sending an empty string
          // would be a different instruction from sending nothing - "no cover"
          // versus "leave whatever is there" - and the create path has no
          // previous value to leave.
          ...(wizard.coverUrl ? { cover_url: wizard.coverUrl } : {}),
          // ---- MANDATORY T&C acceptance ----
          //
          // The backend refuses a channel without these two (`ErrTCNotAccepted`),
          // so they are not optional. The version travels with the acceptance so
          // the stored record says WHICH text was agreed to, which is what makes
          // the acceptance auditable after the terms change.
          tc_accepted: true,
          tc_accepted_version: TC_VERSION,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setChannelErr(data.message ?? data.error ?? 'Could not create channel.');
        return;
      }
      // Success - form reset + list refresh
      setHandle('');
      setDisplayName('');
      setDescription('');
      setWizard(EMPTY_WIZARD);
      setShowChannelForm(false);
      await loadAll();

      // ------------------------------------------------------------------
      // Straight into step 2.
      // ------------------------------------------------------------------
      //
      // Not a "you can finish later" banner and not a link on the channel card.
      // Step 2 is compulsory, and the moment it is least annoying is immediately
      // after creating - the creator already has the channel open in their head and
      // has not been interrupted by anything yet.
      //
      // Dropping them back on the dashboard instead means the next action they see
      // is something else, and a compulsory step that competes with other work is a
      // compulsory step that gets deferred until it stops feeling compulsory.
      //
      // `replace` rather than `push`, so Back does not return to the dashboard they
      // were just bounced off - they would land there, be redirected again, and
      // conclude the app is broken.
      if (data.channel?.id) {
        skipGateBriefly();
        router.replace(`/dashboard/channels/setup?channel=${encodeURIComponent(data.channel.id)}`);
      }
    } catch {
      setChannelErr('Network error. Please try again.');
    } finally {
      setChannelBusy(false);
    }
  }

  // Session identity (avatar/username/role) - shared app-wide via context.
  // Ek hi `/api/auth/me` fetch, saare consumers yahan se padhte hain.
  const identity = useSessionIdentity();

  // ======================================================================
  // PANEL STATE - 3-dot menu se install panel toggle hota hai
  // ======================================================================
  const [panel, setPanel] = useState<'install' | null>(null);

  /**
   * 3-dot menu items.
   *
   * NOTE: `useMemo` isliye nahi lagaya - array chhoti hai aur har render pe
   * naya banana harmless hai (OverflowMenu sirf render ke liye use karta
   * hai, koi state nahi).
   */
  const menuItems: MenuItem[] = [
    {
      id: 'install',
      label: 'Install app',
      hint: 'Add Wideo11 to this device',
      icon: <Download className="h-2.5 w-2.5" />,
      onSelect: () => setPanel('install'),
    },
    {
      id: 'console',
      label: 'Console',
      hint: 'Analytics, alerts and settings',
      icon: <Settings className="h-2.5 w-2.5" />,
      onSelect: () => {
        window.location.href = '/settings';
      },
    },
    {
      id: 'browse',
      label: 'Browse',
      hint: 'Public pages',
      icon: <Compass className="h-2.5 w-2.5" />,
      onSelect: () => {
        window.location.href = '/';
      },
    },
    {
      id: 'logout',
      label: 'Log out',
      hint: 'Sign out on this device',
      icon: <LogOut className="h-2.5 w-2.5" />,
      onSelect: () => void logout(),
      danger: true,
    },
  ];

  // ======================================================================
  // Logout
  // ======================================================================
  async function logout() {
    // Session cookie delete karo. Backend logout endpoint best-effort -
    // cookie clear karna hi primary kaam hai (token server-side tab tak valid
    // rahega jab tak wo expire na ho, lekin browser usse bhejega hi nahi).
    try {
      document.cookie =
        'wideo11_session=; Max-Age=0; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } catch {
      /* noop */
    }
    window.location.href = '/auth/login';
  }

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111217]">
        <Loader2 className="h-8 w-8 animate-spin text-[#5794f2]" />
      </div>
    );
  }

  return (
    // NOTE: `flex` ZAROORI hai - iske bina sidebar aur main content
    // VERTICALLY stack ho jate hain (screenshot me wahi bug dikha). Flex me
    // sidebar left rail banta hai aur content uske bagal me aa jata hai.
    // `items-stretch` (default) ki wajah se sidebar poori height leta hai,
    // jisse uska "Collapse" button bottom pe chipak-ta hai.
    <div className="flex min-h-screen bg-[#111217] text-[#d8d9da]">
      {/* ==================================================================
          SIDEBAR (collapsible icon rail on desktop, slide-in on mobile)
          ================================================================== */}
      <DashboardSidebar />

      {/* ==================================================================
          MAIN COLUMN (header + content)
          ================================================================== */}
      <div className="flex min-w-0 flex-1 flex-col">
      {/* ==================================================================
          HEADER
          ================================================================== */}
      <header className="shrink-0-[#2c3235] bg-[#181b1f]">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* ---- Page title inline (sidebar pe brand already hai, isliye
                yahan duplicate logo nahi - space bachta hai) ---- */}
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Creator dashboard
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {/* ---- Session avatar (B2.4) ----
                Requirement: "session se har jagah uski profile image jaha bhi
                woh jayegi uske sath honi chahiye".

                `useSessionIdentity()` se aata hai - ek hi fetch, pure app
                me shared. Settings me avatar change karte hi `refresh()`
                call hota hai aur YAHAN turant update ho jata hai (page reload
                ki zarurat nahi). */}
            <Link
              href="/dashboard/settings"
              title="Your profile"
              className="flex items-center gap-2 rounded-md p-1 pr-2 transition-colors hover:bg-[#1f2227]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full-[#2c3235] bg-[#0d0f11] text-xs font-bold text-[#5794f2]">
                {identity.avatar_url ? (
                  <img
                    src={identity.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  identity.initials || '?'
                )}
              </span>
              <span className="hidden text-sm text-[#9fa7b3] sm:inline">
                @{identity.username}
              </span>
            </Link>

            {/* ---- Browse: public landing page (desktop pe visible) ---- */}
            <Link href="/">
              <Button variant="ghost" size="sm" className="hidden text-[#9fa7b3] hover:text-[#d8d9da] sm:inline-flex">
                Browse
              </Button>
            </Link>

            {/*
              Video editor.

              The editor runs as its OWN app on its own port, not as a route in
              this one - so the link is absolute and carries the origin
              explicitly. A relative `/editor` here would 404, and the app it
              belongs to is not part of this bundle.

              Hidden on small screens because the header is already carrying the
              identity, Browse and the overflow menu at that width.
            */}
            <a href={VIDEO_EDITOR_URL} target="_blank" rel="noreferrer">
              <Button
                variant="ghost"
                size="sm"
                className="hidden text-[#9fa7b3] hover:text-[#d8d9da] sm:inline-flex"
                title="Open the video editor"
              >
                Video editor
              </Button>
            </a>
            {/* ---- 3-dot overflow menu (Chrome-style) ----
                Isme: Install app (QR bhi), Console, Browse, Log out. */}
            <OverflowMenu label="Dashboard menu" items={menuItems} />
          </div>
        </div>
      </header>

      <main className="min-w-0 flex-1">
        {/* ---- INSTALL PANEL (3-dot menu -> Install app) ---- */}
        {panel === 'install' ? (
          <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
            <InstallPanel onClose={() => setPanel(null)} />
          </div>
        ) : (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">

        {/* ---- PLAN / TRIAL COUNTDOWN ----
            Above everything, because it is the one thing on this page with a
            deadline attached. Under an hour it becomes a live amber timer; over an
            hour it is one quiet line. The component owns that decision and reads
            `trial_expiring_soon` from the SERVER rather than picking its own
            threshold - see `trial-countdown.tsx` for why. */}
        <TrialCountdown />

        {/* ==================================================================
            UPLOAD ENTRY POINT
            ==================================================================
            The upload page is in the sidebar, and the sidebar is easy to miss
            for somebody whose whole reason for being here is to post a video.

            This is the ONE action that turns an empty account into a working
            one, so it gets a button rather than a nav item. It was missing
            entirely for a while, which meant the upload engine - presigned
            PUTs, the ffmpeg ladder, the dedup - was reachable only by typing
            the URL straight into the address bar.

            Kept to a single row so it does not push the actual content out of
            view. */}
        <section className="flex flex-col gap-3 rounded-md bg-[#181b1f] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Upload className="h-2.5 w-2.5 text-[#5794f2]" />
              Upload media
            </h2>
            <p className="mt-1 text-xs text-[#9fa7b3]">
              Videos, reels and audio. Encoded into every quality, ready to
              publish when it finishes.
            </p>
          </div>
          <Link href="/dashboard/upload" className="shrink-0">
            <Button
              size="sm"
              className="h-9 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
            >
              <Upload className="mr-1.5 h-2.5 w-2.5" />
              Upload
            </Button>
          </Link>
        </section>

        {/* ==================================================================
            PANEL 1: PROFILE  (avatar + change image)
            ================================================================== */}
        <section className="rounded-md bg-[#181b1f] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#d8d9da]">
            <User className="h-2.5 w-2.5 text-[#5794f2]" />
            Profile
          </h2>

          <div className="mt-4 flex flex-col gap-5 sm:flex-row">
            {/* ---- Avatar ----
                Image ho to dikhta hai; nahi ho to initials fallback
                (brand ke saath consistent). */}
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="relative h-24 w-24 overflow-hidden rounded-full-[#2c3235] bg-[#111217]">
                {profile?.avatar_url ? (
                  // NOTE: plain <img> - next/image se remote MinIO URL load
                  // karne ke liye hostname allowlist karni padti. Yahan plain
                  // img intentional hai (koi optimization nahi chahiye avatar
                   // ke liye, aur ye user-provided URL hai).
                  <img
                    src={profile.avatar_url}
                    alt="Your profile picture"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-[#5794f2]">
                    {initialsOf(profile)}
                  </div>
                )}
              </div>
              <Camera className="h-2.5 w-2.5 text-[#9fa7b3]" />
            </div>

            {/* ---- Details + avatar editor ---- */}
            <div className="min-w-0 flex-1 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[#9fa7b3]">Username</p>
                  <p className="mt-0.5 font-medium">@{profile?.username || '—'}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-[#9fa7b3]">Email</p>
                  <p className="mt-0.5 truncate font-medium">{profile?.email || '—'}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {profile?.is_verified ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/60 px-2 py-1 text-emerald-300">
                    <Check className="h-2.5 w-2.5" /> Verified
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-950/60 px-2 py-1 text-amber-300">
                    Not verified
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1f2227] px-2 py-1 text-[#9fa7b3]">
                  <ShieldCheck className="h-2.5 w-2.5" /> Security setup complete
                </span>
              </div>

              {/* ---- AVATAR UPLOADER (B2.3) ----
                  Ab real FILE upload hai (apne MinIO me, presigned URL ke
                  through) - URL paste box hata diya gaya.

                  `onUploaded` ke baad `identity.refresh()` call hota hai taaki
                  naya avatar POORI APP me turant dikhe (header, sidebar) -
                  page reload ke bina. */}
              <div className="space-y-2-[#2c3235] pt-3">
                <AvatarUploader
                  currentUrl={profile?.avatar_url}
                  initials={initialsOf(profile)}
                  onUploaded={async (publicUrl: string) => {
                    const ok = await saveAvatarTo(publicUrl);
                    if (ok) await identity.refresh();
                  }}
                />
                {avatarMsg ? (
                  <p
                    className={`text-[11px] ${
                      avatarMsg.ok ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {avatarMsg.text}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ==================================================================
            PANEL 2: CHANNELS  (+ create form)
            ================================================================== */}
        <section className="rounded-md bg-[#181b1f] p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Youtube className="h-2.5 w-2.5 text-[#f2495c]" />
              My channels
              <span className="rounded-full bg-[#1f2227] px-2 py-0.5 text-[11px] font-normal text-[#9fa7b3]">
                {channelLimit === null ? channels.length : `${channels.length} / ${channelLimit}`}
              </span>
            </h2>
            {!showChannelForm ? (
              <Button
                onClick={() => setShowChannelForm(true)}
                size="sm"
                disabled={channelLimit !== null && channels.length >= channelLimit}
                className="h-9 bg-[#5794f2] text-white hover:bg-[#5794f2]/85 disabled:opacity-40"
              >
                <Plus className="mr-1.5 h-2.5 w-2.5" />
                Create channel
              </Button>
            ) : null}
          </div>

          {/* ---- Plan channel limit notice ----
              Shown only when the creator is AT the limit, because a limit that
              is merely far away is noise. The message names the plan so the fix
              (upgrade) is discoverable rather than a dead end. */}
          {channelLimit !== null && channels.length >= channelLimit ? (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-950/20 p-2.5 text-[11px] text-amber-200">
              Aapke plan mein maximum {channelLimit} channel ban sakte hain. Zyada
              channels ke liye{' '}
              <Link href="/dashboard/plans" className="underline hover:no-underline">
                plan upgrade
              </Link>{' '}
              karein.
            </p>
          ) : null}

          {/* ---- Create form (collapsible) ---- */}
          {showChannelForm ? (
            <form onSubmit={createChannel} className="mt-4 space-y-3 rounded-md bg-[#0d0f11] p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[#d8d9da]">New channel</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelForm(false);
                    setChannelErr('');
                  }}                  className="text-[#9fa7b3] transition-colors hover:text-[#d8d9da]"
                  aria-label="Close"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-handle" className="text-xs text-[#9fa7b3]">
                    Handle
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 text-sm text-[#9fa7b3]">@</span>
                    <Input
                      id="ch-handle"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))}
                      placeholder="aarav"
                      maxLength={30}
                      className="h-10-[#2c3235] bg-[#181b1f] text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-name" className="text-xs text-[#9fa7b3]">
                    Display name
                  </Label>
                  <Input
                    id="ch-name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Aarav Sharma"
                    maxLength={80}
                    className="h-10-[#2c3235] bg-[#181b1f] text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ch-desc" className="text-xs text-[#9fa7b3]">
                  Description (optional)
                </Label>
                <textarea
                  id="ch-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="What is this channel about?"
                  className="w-full rounded-md bg-[#181b1f] px-3 py-2 text-sm text-[#d8d9da] placeholder:text-[#9fa7b3]/50 focus:border-[#5794f2] focus:outline-none"
                />
              </div>

                <ChannelWizardFields
                  value={wizard}
                  // Functional updater, because the field is a "set one key"
                  // helper internally and a plain value would make two answers
                  // in the same tick overwrite each other.
                  onChange={(updater) => setWizard(updater)}
                />

              {channelErr ? (
                <p className="text-[11px] text-red-400">{channelErr}</p>
              ) : null}

              <Button
                type="submit"
                disabled={channelBusy}
                className="h-10 w-full bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
              >
                {channelBusy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : 'Create channel'}
              </Button>
            </form>
          ) : null}

          {/* ---- T&C dialog ----
              Rendered outside the form so it is not clipped by it and can cover
              the whole viewport. Cancel returns to the form with nothing
              submitted; accept marks the consent for THIS create and submits
              immediately — the creator should not have to press the button
              twice for one channel. */}
          <ChannelTermsDialog
            open={tcDialogOpen}
            onCancel={() => setTcDialogOpen(false)}
            onAccept={() => {
              setTcAccepted(true);
              setTcDialogOpen(false);
              void submitChannelWithTerms();
            }}
          />

          {/* ---- Channel list ---- */}
          <div className="mt-4">
            {channels.length === 0 ? (
              <div className="rounded-md-dashed-[#2c3235] p-6 text-center">
                <Youtube className="mx-auto h-6 w-6 text-[#9fa7b3]" />
                <p className="mt-2 text-sm text-[#d8d9da]">No channels yet</p>
                <p className="mt-1 text-xs text-[#9fa7b3]">
                  Create your first channel to start publishing.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {channels.map((ch) => (
                  <ChannelManager
                    key={ch.id}
                    channel={ch}
                    onChanged={loadAll}
                    onDeleted={loadAll}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ==================================================================
            PANEL 3: DEVICES  (kis device par login hai)
            ================================================================== */}
        <section className="rounded-md bg-[#181b1f] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Monitor className="h-2.5 w-2.5 text-[#73bf69]" />
            Signed-in devices
            <span className="rounded-full bg-[#1f2227] px-2 py-0.5 text-[11px] font-normal text-[#9fa7b3]">
              {devices.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-[#9fa7b3]">
            Every active session on your account. Changing your security PIN signs
            out all of them.
          </p>

          <ul className="mt-4 space-y-2">
            {devices.length === 0 ? (
              <li className="rounded-md-dashed-[#2c3235] p-4 text-center text-xs text-[#9fa7b3]">
                No active devices found.
              </li>
            ) : (
              devices.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-1 rounded-md bg-[#0d0f11] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{deviceLabel(d.user_agent)}</p>
                    <p className="truncate text-[11px] text-[#9fa7b3]">
                      {d.ip_address || 'IP unavailable'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-[#9fa7b3]">
                      Active {timeAgo(d.last_seen)}
                    </p>
                    <p className="text-[10px] text-[#9fa7b3]/60">
                      Signed in {timeAgo(d.created_at)}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
        </div>
        )}
      </main>
      </div>
    </div>
  );
}
