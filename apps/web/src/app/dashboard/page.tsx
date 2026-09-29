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

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { Label } from '@wideo11/ui/label';
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
  is_public: boolean;
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
  // ---- Data ----
  const [profile, setProfile] = useState<Profile | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [devices, setDevices] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(true);

  // ---- Avatar state ----
  const [avatarInput, setAvatarInput] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMsg, setAvatarMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- Channel form state ----
  const [showChannelForm, setShowChannelForm] = useState(false);
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelErr, setChannelErr] = useState('');

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

  useEffect(() => {
    void loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  // ======================================================================
  // Avatar save
  // ======================================================================
  async function saveAvatar() {
    setAvatarBusy(true);
    setAvatarMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: avatarInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAvatarMsg({ ok: false, text: data.message ?? data.error ?? 'Could not save avatar.' });
        return;
      }
      setAvatarMsg({ ok: true, text: 'Profile image updated.' });
      await loadAll();
    } catch {
      setAvatarMsg({ ok: false, text: 'Network error. Please try again.' });
    } finally {
      setAvatarBusy(false);
    }
  }

  // ======================================================================
  // Create channel
  // ======================================================================
  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    setChannelErr('');
    // Client-side format check (UX). Backend bhi SAME rule validate karta hai
    // (aur DB constraint bhi) - teen jagah ek jaisa rule.
    if (!/^[a-z0-9._-]{3,30}$/.test(handle.trim().toLowerCase())) {
      setChannelErr('Handle must be 3-30 characters: a-z, 0-9, _ . or -');
      return;
    }
    if (!displayName.trim()) {
      setChannelErr('Give your channel a display name.');
      return;
    }

    setChannelBusy(true);
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: handle.trim().toLowerCase(),
          display_name: displayName.trim(),
          description: description.trim(),
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
      setShowChannelForm(false);
      await loadAll();
    } catch {
      setChannelErr('Network error. Please try again.');
    } finally {
      setChannelBusy(false);
    }
  }

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
      icon: <Download className="h-4 w-4" />,
      onSelect: () => setPanel('install'),
    },
    {
      id: 'console',
      label: 'Console',
      hint: 'Analytics, alerts and settings',
      icon: <Settings className="h-4 w-4" />,
      onSelect: () => {
        window.location.href = '/settings';
      },
    },
    {
      id: 'browse',
      label: 'Browse',
      hint: 'Public pages',
      icon: <Compass className="h-4 w-4" />,
      onSelect: () => {
        window.location.href = '/';
      },
    },
    {
      id: 'logout',
      label: 'Log out',
      hint: 'Sign out on this device',
      icon: <LogOut className="h-4 w-4" />,
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
      <header className="shrink-0 border-b border-[#2c3235] bg-[#181b1f]">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* ---- Page title inline (sidebar pe brand already hai, isliye
                yahan duplicate logo nahi - space bachta hai) ---- */}
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Creator dashboard
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {/* ---- Browse: public landing page (desktop pe visible) ---- */}
            <Link href="/">
              <Button variant="ghost" size="sm" className="hidden text-[#9fa7b3] hover:text-[#d8d9da] sm:inline-flex">
                Browse
              </Button>
            </Link>
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

        {/* ==================================================================
            PANEL 1: PROFILE  (avatar + change image)
            ================================================================== */}
        <section className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#d8d9da]">
            <User className="h-4 w-4 text-[#5794f2]" />
            Profile
          </h2>

          <div className="mt-4 flex flex-col gap-5 sm:flex-row">
            {/* ---- Avatar ----
                Image ho to dikhta hai; nahi ho to initials fallback
                (brand ke saath consistent). */}
            <div className="flex shrink-0 flex-col items-center gap-2">
              <div className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-[#2c3235] bg-[#111217]">
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
              <Camera className="h-3.5 w-3.5 text-[#9fa7b3]" />
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
                    <Check className="h-3 w-3" /> Verified
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-950/60 px-2 py-1 text-amber-300">
                    Not verified
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1f2227] px-2 py-1 text-[#9fa7b3]">
                  <ShieldCheck className="h-3 w-3" /> Security setup complete
                </span>
              </div>

              {/* ---- Avatar URL editor ----
                  NOTE: abhi URL-based hai (MinIO ya koi bhi http(s) URL).
                  Abhi FILE UPLOAD ka flow nahi hai - backend sirf URL store
                  karta hai. Upload flow agla step hai; tab ye input
                  auto-fill ho jayega. */}
              <div className="space-y-2 border-t border-[#2c3235] pt-3">
                <Label htmlFor="avatar" className="text-xs text-[#9fa7b3]">
                  Profile image URL
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="avatar"
                    value={avatarInput}
                    onChange={(e) => setAvatarInput(e.target.value)}
                    placeholder="https://... ya /avatars/me.png"
                    className="h-10 border-[#2c3235] bg-[#0d0f11] text-sm"
                  />
                  <Button
                    onClick={saveAvatar}
                    disabled={avatarBusy}
                    className="h-10 shrink-0 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
                  >
                    {avatarBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
                {avatarMsg ? (
                  <p
                    className={`text-[11px] ${
                      avatarMsg.ok ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {avatarMsg.text}
                  </p>
                ) : (
                  <p className="text-[11px] text-[#9fa7b3]">
                    Paste an image URL. Leave empty and save to remove it.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ==================================================================
            PANEL 2: CHANNELS  (+ create form)
            ================================================================== */}
        <section className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Youtube className="h-4 w-4 text-[#f2495c]" />
              My channels
              <span className="rounded-full bg-[#1f2227] px-2 py-0.5 text-[11px] font-normal text-[#9fa7b3]">
                {channels.length}
              </span>
            </h2>
            {!showChannelForm ? (
              <Button
                onClick={() => setShowChannelForm(true)}
                size="sm"
                className="h-9 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Create channel
              </Button>
            ) : null}
          </div>

          {/* ---- Create form (collapsible) ---- */}
          {showChannelForm ? (
            <form onSubmit={createChannel} className="mt-4 space-y-3 rounded-lg border border-[#2c3235] bg-[#0d0f11] p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[#d8d9da]">New channel</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelForm(false);
                    setChannelErr('');
                  }}
                  className="text-[#9fa7b3] transition-colors hover:text-[#d8d9da]"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
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
                      className="h-10 border-[#2c3235] bg-[#181b1f] text-sm"
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
                    className="h-10 border-[#2c3235] bg-[#181b1f] text-sm"
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
                  className="w-full rounded-lg border border-[#2c3235] bg-[#181b1f] px-3 py-2 text-sm text-[#d8d9da] placeholder:text-[#9fa7b3]/50 focus:border-[#5794f2] focus:outline-none"
                />
              </div>

              {channelErr ? (
                <p className="text-[11px] text-red-400">{channelErr}</p>
              ) : null}

              <Button
                type="submit"
                disabled={channelBusy}
                className="h-10 w-full bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
              >
                {channelBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create channel'}
              </Button>
            </form>
          ) : null}

          {/* ---- Channel list ---- */}
          <div className="mt-4">
            {channels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#2c3235] p-6 text-center">
                <Youtube className="mx-auto h-6 w-6 text-[#9fa7b3]" />
                <p className="mt-2 text-sm text-[#d8d9da]">No channels yet</p>
                <p className="mt-1 text-xs text-[#9fa7b3]">
                  Create your first channel to start publishing.
                </p>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {channels.map((ch) => (
                  <li
                    key={ch.id}
                    className="rounded-lg border border-[#2c3235] bg-[#0d0f11] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{ch.display_name}</p>
                        <p className="truncate text-xs text-[#5794f2]">@{ch.handle}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#1f2227] px-2 py-0.5 text-[10px] text-[#9fa7b3]">
                        {ch.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                    {ch.description ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[#9fa7b3]">
                        {ch.description}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[10px] text-[#9fa7b3]/70">
                      Created {timeAgo(ch.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ==================================================================
            PANEL 3: DEVICES  (kis device par login hai)
            ================================================================== */}
        <section className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Monitor className="h-4 w-4 text-[#73bf69]" />
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
              <li className="rounded-lg border border-dashed border-[#2c3235] p-4 text-center text-xs text-[#9fa7b3]">
                No active devices found.
              </li>
            ) : (
              devices.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-col gap-1 rounded-lg border border-[#2c3235] bg-[#0d0f11] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
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
