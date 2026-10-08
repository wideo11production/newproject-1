'use client';

/**
 * ============================================================================
 * USER SETTINGS HUB  -  /dashboard/settings
 * ============================================================================
 *
 * REQUIREMENT: "user ko setting baar baar change na karni pade - SAARI
 * settings EK hi unified view me, ek jagah".
 *
 * Isliye ye page ek SCROLLABLE GRID hai - profile, appearance, security,
 * content, aur notifications sab ek hi page par. Koi sub-tab nahi, koi
 * "aur settings dhundho" nahi. User ko sirf ek jagah aana hai.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERYTHING IS IN ONE GRID (design rationale)
 * ---------------------------------------------------------------------------
 * Typical settings UX me user ko 4-5 jagah jaana padta hai: profile alag,
 * security alag, appearance alag, billing alag. Har baar ek hi cheez yaad
 * rakhni padti hai. Grid layout is problem ko solve karta hai - related
 * cheezein saath dikhti hain, aur scroll karke sab mil jata hai.
 *
 * Mobile par single column, desktop par 2-column grid - zyada wide screens
 * me zyada dikhta hai bina mouse-juggling ke.
 *
 * ---------------------------------------------------------------------------
 * THEME APPLYING (SSOT, not a localStorage hack)
 * ---------------------------------------------------------------------------
 * Jab user theme change karta hai, wo TURANT apply hota hai - `document`
 * par attributes set kar ke. Ye zaroori hai: user ko turant feedback milna
 * chahiye, warna "Save" click karna padega sirf dekhne ke liye.
 *
 * Settings PERSISTED DB me hain (localStorage me nahi), isliye:
 *   - logout karne par settings nahi miti
 *   - doosre device par wahi theme milegi
 *   - ye true SSOT hai
 *
 * Hinglish comments: har block ka arth
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  ChevronLeft,
  CircleUser,
  KeyRound,
  Loader2,
  Lock,
  Palette,
  Save,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  Upload,
  Languages,
  Video,
  Users,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Input } from '@wideo11/ui/input';
import { RevealableInput } from '@/components/ui/revealable-input';
import { Label } from '@wideo11/ui/label';
import { BrandLockup } from '@wideo11/ui/brand/characters';

// ---------------------------------------------------------------------------
// Types (backend ke response se match)
// ---------------------------------------------------------------------------
type Settings = {
  email: string;
  username: string;
  full_name: string;
  avatar_url: string;
  role: string;
  theme: string;
  accent: string;
  language: string;
  content_upload_enabled: boolean;
  // Effective capability - NOT the same as the toggle above. The toggle is
  // the user's intent; this is whether an upload would actually be accepted
  // (intent + verified email + active account).
  content_upload_allowed: boolean;
  // 'allowed' | 'disabled_by_user' | 'email_unverified' | 'account_inactive'
  content_upload_reason: string;
  subscriptions_enabled: boolean;
  email_notifications: boolean;
};

type Meta = {
  themes: string[];
  accents: { Hex: string; Name: string }[];
  languages: { Code: string; Name: string }[];
};

/**
 * Upload-blocked reason -> user-facing message.
 *
 * The server sends an enum, not prose, so the wording lives in ONE place here
 * rather than being duplicated per call site.
 *
 * The important property: each message tells the user what they can DO. Telling
 * someone "not allowed" without a next step is what made this feel broken in
 * the first place.
 */
function uploadBlockedMessage(reason: string): string {
  switch (reason) {
    case 'email_unverified':
      return 'Verify your email address to enable uploads. Your toggle is already on.';
    case 'account_inactive':
      return 'Your account is inactive, so uploads are unavailable. Contact support to reactivate it.';
    case 'disabled_by_user':
      return 'Turn the toggle above back on to upload content.';
    default:
      // Unknown reason - the server added a new one this build does not know.
      // Stay honest rather than guessing at wording we cannot verify.
      return 'Uploads are unavailable right now. Contact support if this looks wrong.';
  }
}

/** Short hint shown under the toggle label. */
function uploadBlockedHint(reason: string): string {
  switch (reason) {
    case 'email_unverified':
      return 'Blocked until your email is verified';
    case 'account_inactive':
      return 'Blocked while your account is inactive';
    default:
      return 'Currently blocked by another condition';
  }
}

/** Theme options ka display - label + inline swatch colour */const THEME_META: Record<string, { label: string; hint: string; swatch: string[] }> = {
  dark: {
    label: 'Dark',
    hint: 'Current Grafana dark',
    swatch: ['#111217', '#181b1f', '#5794f2'],
  },
  light: {
    label: 'Light',
    hint: 'Clean and bright',
    swatch: ['#ffffff', '#f4f5f7', '#2563eb'],
  },
  midnight: {
    label: 'Midnight',
    hint: 'OLED friendly, deep blue-black',
    swatch: ['#05070f', '#0b1020', '#4361ee'],
  },
  highcontrast: {
    label: 'High contrast',
    hint: 'Maximum legibility',
    swatch: ['#000000', '#1a1a1a', '#ffd400'],
  },
};

export default function UserSettingsPage() {
  // ---- Data ----
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  // ---- Avatar ----
  const [avatarInput, setAvatarInput] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);

  // ---- Save state (per-section feedback) ----
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  // ---- PIN rollover ----
  //
  // TWO-STEP UNLOCK (requirement: "sahi PIN daalo TABHI change pin wala card
  // open karo").
  //
  // `pinUnlocked` false hai to sirf CURRENT PIN field + Unlock button dikhta
  // hai - naya PIN form HIDDEN rehta hai. Verify pass hone par form reveal
  // hota hai.
  //
  // SECURITY: unlock sirf UI reveal hai, authorization nahi. Final
  // `rollover` call par old PIN DOBARA server par verify hota hai - yaani
  // beech me koi state unlock kar de, tab bhi bina sahi PIN ke naya PIN
  // set NAHI ho sakta. Ye deliberate "fail closed at the real action" design
  // hai - sirf UI gate pe depend karna unsafe hota.
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinCheckBusy, setPinCheckBusy] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);

  // ---- Password ----
  // Same two-step pattern: current password verify -> new password form.
  const [pwUnlocked, setPwUnlocked] = useState(false);
  const [pwCheckBusy, setPwCheckBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);

  // ---- Load ----
  useEffect(() => {
    const load = async () => {
      const [sRes, mRes] = await Promise.allSettled([
        fetch('/api/auth/settings', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/auth/settings-meta', { cache: 'no-store' }).then((r) => r.json()),
      ]);
      if (sRes.status === 'fulfilled' && sRes.value) {
        setSettings(sRes.value as Settings);
        setAvatarInput((sRes.value as Settings).avatar_url ?? '');
      }
      if (mRes.status === 'fulfilled' && mRes.value) setMeta(mRes.value as Meta);
      setLoading(false);
    };
    void load();
  }, []);

  const flash = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // =========================================================================
  // THEME APPLY (instant, before save)
  // =========================================================================
  //
  // Instant feedback zaroori hai - user ko turant dikhna chahiye. DB me
  // save hone me network latency lagti hai, uska wait karke dikhane se
  // "kuch hua hi nahi" lagta hai.
  const applyThemeInstant = useCallback((theme: string) => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.classList.remove('dark', 'light', 'midnight', 'highcontrast');
    root.classList.add(theme);
    // `colorScheme` browser chrome (scrollbar, form controls) ko match karta hai
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  }, []);

  // =========================================================================
  // SAVE (PATCH - partial update)
  // =========================================================================
  const save = useCallback(
    async (patch: Record<string, unknown>, label: string) => {
      setSaving(label);
      try {
        const res = await fetch('/api/auth/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          flash(false, data?.message ?? 'Could not save.');
          return false;
        }
        // Server truth wapas le lo (accent normalize ho sakta hai)
        if (data?.settings) {
          setSettings((prev) => (prev ? { ...prev, ...data.settings } : prev));
        }
        flash(true, 'Saved');
        return true;
      } catch {
        flash(false, 'Network error. Please try again.');
        return false;
      } finally {
        setSaving(null);
      }
    },
    [flash]
  );

  // ---- Avatar save ----
  async function saveAvatar() {
    setAvatarBusy(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: avatarInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(false, data?.message ?? 'Could not update avatar.');
        return;
      }
      setSettings((prev) => (prev ? { ...prev, avatar_url: avatarInput.trim() } : prev));
      flash(true, 'Profile image updated');
    } catch {
      flash(false, 'Network error. Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  // =========================================================================
  // PIN: step 1 - verify current PIN to unlock the change form
  // =========================================================================
  async function unlockPinForm() {
    setPinCheckBusy(true);
    try {
      const res = await fetch('/api/auth/security/pin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: currentPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(false, data?.message ?? 'That PIN is not correct.');
        return;
      }
      // Unlock: ab naya PIN form dikhega
      setPinUnlocked(true);
      flash(true, 'PIN confirmed. Set your new PIN below.');
    } catch {
      flash(false, 'Network error. Please try again.');
    } finally {
      setPinCheckBusy(false);
    }
  }

  // =========================================================================
  // PASSWORD: step 1 - verify current password to unlock the change form
  // =========================================================================
  async function unlockPasswordForm() {
    setPwCheckBusy(true);
    try {
      const res = await fetch('/api/auth/password/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: currentPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(false, data?.message ?? 'That password is not correct.');
        return;
      }
      setPwUnlocked(true);
      flash(true, 'Password confirmed. Set your new password below.');
    } catch {
      flash(false, 'Network error. Please try again.');
    } finally {
      setPwCheckBusy(false);
    }
  }

  // =========================================================================
  // PIN ROLLOVER (step 2 - runs only after unlock)
  // =========================================================================
  async function rolloverPin() {
    setPinBusy(true);
    try {
      const res = await fetch('/api/auth/security/pin/rollover', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_pin: currentPin, new_pin: newPin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(false, data?.message ?? 'Could not change your PIN.');
        return;
      }
      const c = data?.cleanup;
      flash(
        true,
        `PIN changed. Signed out ${c?.sessions_revoked ?? 0} other device(s), cleaned ${c?.refresh_tokens_deleted ?? 0} refresh token(s).`
      );
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setPinUnlocked(false);
    } catch {
      flash(false, 'Network error. Please try again.');
    } finally {
      setPinBusy(false);
    }
  }

  // =========================================================================
  // PASSWORD CHANGE
  // =========================================================================
  async function changePassword() {
    setPasswordBusy(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash(false, data?.message ?? 'Could not change your password.');
        return;
      }
      const c = data?.cleanup;
      flash(
        true,
        `Password changed. Signed out ${c?.sessions_revoked ?? 0} other device(s).`
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwUnlocked(false);
    } catch {
      flash(false, 'Network error. Please try again.');
    } finally {
      setPasswordBusy(false);
    }
  }

  // ---- Guards ----
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#111217]">
        <Loader2 className="h-8 w-8 animate-spin text-[#5794f2]" />
      </div>
    );
  }

  const pinReady =
    currentPin.length === 6 && newPin.length === 6 && newPin === confirmPin;
  const passwordReady =
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    newPassword === confirmPassword;

  return (
    <div className="min-h-screen bg-[#111217] text-[#d8d9da]">
      {/* ---- Header ---- */}
      <header className="border-b-[#2c3235] bg-[#181b1f]">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link
            href="/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]"
            aria-label="Back to dashboard"
          >
            <ChevronLeft className="h-2.5 w-2.5" aria-hidden="true" />
          </Link>
          <BrandLockup size={24} />
          <span className="text-sm font-semibold">Settings</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your settings</h1>
          <p className="mt-1 text-sm text-[#9fa7b3]">
            Everything in one place. Changes apply to all your devices.
          </p>
        </div>

        {/* ---- Toast ---- */}
        {toast ? (
          <div
            role="status"
            className={`flex items-start gap-2.5 rounded-md p-3 text-sm ${
              toast.ok
                ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                : 'border-red-700/50 bg-red-950/30 text-red-300'
            }`}
          >
            {toast.ok ? (
              <CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            )}
            <p className="leading-relaxed">{toast.text}</p>
          </div>
        ) : null}

        {/* ==================================================================
            GRID - 1 column mobile, 2 columns desktop
            ================================================================== */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---- CARD 1: PROFILE + AVATAR ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <CircleUser className="h-2.5 w-2.5 text-[#5794f2]" aria-hidden="true" />
              Profile
            </h2>

            <div className="mt-4 flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full-[#2c3235] bg-[#0d0f11]">
                {settings?.avatar_url ? (
                  <img
                    src={settings.avatar_url}
                    alt="Your profile picture"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-bold text-[#5794f2]">
                    {(settings?.username || settings?.email || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">@{settings?.username}</p>
                <p className="truncate text-xs text-[#9fa7b3]">{settings?.email}</p>
                {settings?.role === 'superadmin' ? (
                  <span className="mt-1 inline-block rounded-full bg-amber-950/60 px-2 py-0.5 text-[10px] text-amber-300">
                    Superadmin
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <Label htmlFor="avatar" className="text-xs text-[#9fa7b3]">
                Profile image URL
              </Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="avatar"
                  value={avatarInput}
                  onChange={(e) => setAvatarInput(e.target.value)}
                  placeholder="https://... ya /avatars/me.png"
                  className="h-10-[#2c3235] bg-[#0d0f11] text-sm"
                />
                <Button
                  onClick={saveAvatar}
                  disabled={avatarBusy}
                  className="h-10 shrink-0 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
                >
                  {avatarBusy ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <>
                      <Upload className="mr-1.5 h-2.5 w-2.5" aria-hidden="true" />
                      Save
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-[#9fa7b3]">
                Paste an image address. Clear it and save to remove.
              </p>
            </div>
          </section>

          {/* ---- CARD 2: APPEARANCE (theme + accent) ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Palette className="h-2.5 w-2.5 text-[#a78bfa]" aria-hidden="true" />
              Appearance
            </h2>

            {/* ---- Theme ----
                Click karte hi INSTANT apply hota hai (user ko turant feedback).
                DB me save karne ke liye "Save" button hai. */}
            <div className="mt-4 space-y-2">
              <Label className="text-xs text-[#9fa7b3]">Theme</Label>
              <div className="grid grid-cols-2 gap-2">
                {(meta?.themes ?? Object.keys(THEME_META)).map((theme) => {
                  const m = THEME_META[theme];
                  const active = settings?.theme === theme;
                  return (
                    <button
                      key={theme}
                      type="button"
                      onClick={() => {
                        setSettings((prev) => (prev ? { ...prev, theme } : prev));
                        applyThemeInstant(theme);
                      }}
                      className={`rounded-md p-2.5 text-left transition-colors ${
                        active
                          ? 'border-[#5794f2] bg-[#1f2227]'
                          : 'border-[#2c3235] hover:border-[#3d4348]'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {(m?.swatch ?? ['#2c3235', '#2c3235', '#2c3235']).map((c, i) => (
                          <span
                            key={i}
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: c }}
                          />
                        ))}
                        {active ? (
                          <Check className="ml-auto h-2.5 w-2.5 text-[#5794f2]" aria-hidden="true" />
                        ) : null}
                      </span>
                      <span className="mt-1.5 block text-xs font-medium">
                        {m?.label ?? theme}
                      </span>
                      {m?.hint ? (
                        <span className="mt-0.5 block text-[10px] text-[#9fa7b3]">
                          {m.hint}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- Accent ---- */}
            <div className="mt-4 space-y-2">
              <Label className="text-xs text-[#9fa7b3]">Accent colour</Label>
              <div className="flex flex-wrap gap-2">
                {(meta?.accents ?? []).map((a) => {
                  const active = settings?.accent === a.Hex;
                  return (
                    <button
                      key={a.Hex}
                      type="button"
                      title={a.Name}
                      aria-label={a.Name}
                      onClick={() =>
                        setSettings((prev) => (prev ? { ...prev, accent: a.Hex } : prev))
                      }
                      className={`h-8 w-8 rounded-full transition-transform ${
                        active ? 'scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ background: a.Hex }}
                    />
                  );
                })}
              </div>
            </div>

            <Button
              onClick={() =>
                save(
                  { theme: settings?.theme, accent: settings?.accent },
                  'appearance'
                )
              }
              disabled={saving === 'appearance'}
              className="mt-4 h-10 w-full bg-[#1f2227] text-[#d8d9da] hover:bg-[#2c3235]"
            >
              {saving === 'appearance' ? (
                <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
              ) : (
                <>
                  <Save className="mr-1.5 h-2.5 w-2.5" aria-hidden="true" />
                  Save appearance
                </>
              )}
            </Button>
          </section>

          {/* ---- CARD 3: LANGUAGE ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Languages className="h-2.5 w-2.5 text-[#73bf69]" aria-hidden="true" />
              Language
            </h2>

            <div className="mt-4 space-y-2">
              <Label htmlFor="language" className="text-xs text-[#9fa7b3]">
                App language
              </Label>
              <select
                id="language"
                value={settings?.language ?? 'en'}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, language: e.target.value } : prev))
                }
                className="h-10 w-full rounded-md bg-[#0d0f11] px-3 text-sm text-[#d8d9da] focus:border-[#5794f2] focus:outline-none"
              >
                {(meta?.languages ?? []).map((l) => (
                  <option key={l.Code} value={l.Code} className="bg-[#181b1f]">
                    {l.Name}
                  </option>
                ))}
              </select>
            </div>

            <Button
              onClick={() => save({ language: settings?.language }, 'language')}
              disabled={saving === 'language'}
              className="mt-4 h-10 w-full bg-[#1f2227] text-[#d8d9da] hover:bg-[#2c3235]"
            >
              {saving === 'language' ? (
                <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
              ) : (
                'Save language'
              )}
            </Button>
          </section>

          {/* ---- CARD 4: CONTENT + SUBSCRIPTIONS ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Video className="h-2.5 w-2.5 text-[#f2495c]" aria-hidden="true" />
              Content and subscriptions
            </h2>

            <div className="mt-4 space-y-3">
              {/* ---- WHY THIS HINT IS NOT JUST STATIC TEXT ----
               *
               * `content_upload_enabled` is the user's INTENT, but uploads are
               * also blocked by things the toggle does not control (unverified
               * email, inactive account). Showing only the toggle meant a user
               * could have it ON and still be refused at upload time with no
               * explanation - the exact "persisted but inert" gap this fixes.
               *
               * So when the toggle is ON but uploads are still refused, we say
               * WHY, and the message tells them what they can actually do.
               */}
              <ToggleRow
                icon={<Upload className="h-2.5 w-2.5" />}
                label="Allow me to upload content"
                hint={
                  settings?.content_upload_enabled &&
                  settings?.content_upload_allowed === false
                    ? uploadBlockedHint(settings.content_upload_reason)
                    : 'Show the upload option across your dashboard'
                }
                checked={settings?.content_upload_enabled ?? true}
                onChange={(v) => {
                  setSettings((prev) =>
                    prev ? { ...prev, content_upload_enabled: v } : prev
                  );
                  void save({ content_upload_enabled: v }, 'content');
                }}
              />
              {settings?.content_upload_enabled &&
              settings?.content_upload_allowed === false ? (
                <p
                  role="status"
                  className="flex items-start gap-1.5 rounded-md border-700/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300"
                >
                  <AlertTriangle
                    className="mt-0.5 h-2.5 w-2.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{uploadBlockedMessage(settings.content_upload_reason)}</span>
                </p>
              ) : null}
              <ToggleRow
                icon={<Users className="h-2.5 w-2.5" />}
                label="Allow viewer subscriptions"
                hint="Viewers can subscribe to your channel"
                checked={settings?.subscriptions_enabled ?? true}
                onChange={(v) => {
                  setSettings((prev) =>
                    prev ? { ...prev, subscriptions_enabled: v } : prev
                  );
                  void save({ subscriptions_enabled: v }, 'subs');
                }}
              />
              <ToggleRow
                icon={<Bell className="h-2.5 w-2.5" />}
                label="Email notifications"
                hint="Payout and security alerts"
                checked={settings?.email_notifications ?? true}
                onChange={(v) => {
                  setSettings((prev) =>
                    prev ? { ...prev, email_notifications: v } : prev
                  );
                  void save({ email_notifications: v }, 'email');
                }}
              />
            </div>
          </section>

          {/* ---- CARD 5: SECURITY PIN (locked -> unlocked) ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <KeyRound className="h-2.5 w-2.5 text-[#f2cc0c]" aria-hidden="true" />
              Security PIN
            </h2>
            <p className="mt-1 text-xs text-[#9fa7b3]">
              {pinUnlocked
                ? 'PIN confirmed. Choose your new 6-digit PIN.'
                : 'Confirm your current PIN to unlock the change form.'}
            </p>

            {/* ---- STEP 1 (LOCKED): sirf current PIN ----
                Naya PIN form YAHAN tak hidden hai jab tak current PIN
                verify nahi hota - yahi requirement hai. */}
            {!pinUnlocked ? (
              <div className="mt-4 space-y-3">
                <PinField
                  id="currentPin"
                  label="Current 6-digit PIN"
                  value={currentPin}
                  onChange={setCurrentPin}
                />
                <Button
                  onClick={unlockPinForm}
                  disabled={pinCheckBusy || currentPin.length !== 6}
                  className="h-10 w-full bg-[#1f2227] text-[#d8d9da] hover:bg-[#2c3235]"
                >
                  {pinCheckBusy ? (
                    <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <>
                      <Lock className="mr-1.5 h-2.5 w-2.5" aria-hidden="true" />
                      Confirm PIN
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* ---- STEP 2 (UNLOCKED): naya PIN form ---- */
              <div className="mt-4 space-y-3">
                <PinField
                  id="newPin"
                  label="New 6-digit PIN"
                  value={newPin}
                  onChange={setNewPin}
                />
                <PinField
                  id="confirmPin"
                  label="Confirm new PIN"
                  value={confirmPin}
                  onChange={setConfirmPin}
                  error={
                    confirmPin.length === 6 && newPin !== confirmPin
                      ? 'PINs do not match'
                      : null
                  }
                />
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      // wapas locked state - user dobara confirm kar sakta hai
                      setPinUnlocked(false);
                      setCurrentPin('');
                      setNewPin('');
                      setConfirmPin('');
                    }}
                    variant="ghost"
                    className="h-10 shrink-0-[#2c3235] text-[#9fa7b3] hover:bg-[#1f2227]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={rolloverPin}
                    disabled={!pinReady || pinBusy}
                    className="h-10 flex-1 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
                  >
                    {pinBusy ? (
                      <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
                    ) : (
                      'Change PIN'
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-[#9fa7b3]">
                  Changing your PIN signs out every other device.
                </p>
              </div>
            )}
          </section>

          {/* ---- CARD 6: PASSWORD (locked -> unlocked) ---- */}
          <section className="rounded-md bg-[#181b1f] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-2.5 w-2.5 text-[#8ab8ff]" aria-hidden="true" />
              Password
            </h2>
            <p className="mt-1 text-xs text-[#9fa7b3]">
              {pwUnlocked
                ? 'Password confirmed. Set your new password below.'
                : 'Confirm your current password to unlock the change form.'}
            </p>

            {/* ---- STEP 1 (LOCKED) ----
                Same pattern as PIN: naya password form current password
                verify hone tak hidden rehta hai. */}
            {!pwUnlocked ? (
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="curPw" className="text-xs text-[#9fa7b3]">
                    Current password
                  </Label>
                  {/*
                    Revealable, because the next step is "Confirm password" and a
                    failed confirmation is almost always a character nobody can
                    see. Revealing it turns a guess into a reading.
                  */}
                  <RevealableInput
                    id="curPw"
                    autoComplete="current-password"
                    value={currentPassword}
                    onValueChange={setCurrentPassword}
                    revealLabel="Show current password"
                    hideLabel="Hide current password"
                    className="h-10-[#2c3235] bg-[#0d0f11] text-sm"
                  />
                </div>
                <Button
                  onClick={unlockPasswordForm}
                  disabled={pwCheckBusy || currentPassword.length === 0}
                  className="h-10 w-full bg-[#1f2227] text-[#d8d9da] hover:bg-[#2c3235]"
                >
                  {pwCheckBusy ? (
                    <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <>
                      <Lock className="mr-1.5 h-2.5 w-2.5" aria-hidden="true" />
                      Confirm password
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* ---- STEP 2 (UNLOCKED): naya password form ---- */
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="newPw" className="text-xs text-[#9fa7b3]">
                    New password
                  </Label>
                  <RevealableInput
                    id="newPw"
                    autoComplete="new-password"
                    value={newPassword}
                    onValueChange={setNewPassword}
                    revealLabel="Show new password"
                    hideLabel="Hide new password"
                    className="h-10-[#2c3235] bg-[#0d0f11] text-sm"
                  />
                  {newPassword.length > 0 && newPassword.length < 12 ? (
                    <p className="text-[11px] text-amber-400">
                      {newPassword.length}/12 characters
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confPw" className="text-xs text-[#9fa7b3]">
                    Confirm new password
                  </Label>
                  {/*
                    The one field where reveal matters MOST.

                    "Passwords do not match" is the single most common confusing
                    rejection in any product, and the cause is always a character
                    the person cannot see. Revealing both fields side by side makes
                    the difference visible instantly.

                    `autoComplete="new-password"` is KEPT on both, deliberately:
                    that is what tells a password manager not to offer an existing
                    credential for a field that is creating a new one. Dropping it
                    would be easier to type and worse to use.
                  */}
                  <RevealableInput
                    id="confPw"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onValueChange={setConfirmPassword}
                    revealLabel="Show confirmed password"
                    hideLabel="Hide confirmed password"
                    className="h-10-[#2c3235] bg-[#0d0f11] text-sm"
                  />
                  {confirmPassword.length > 0 &&
                  confirmPassword !== newPassword ? (
                    <p className="text-[11px] text-amber-400">
                      Passwords do not match
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setPwUnlocked(false);
                      setCurrentPassword('');
                      setNewPassword('');
                      setConfirmPassword('');
                    }}
                    variant="ghost"
                    className="h-10 shrink-0-[#2c3235] text-[#9fa7b3] hover:bg-[#1f2227]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={changePassword}
                    disabled={!passwordReady || passwordBusy}
                    className="h-10 flex-1 bg-[#5794f2] text-white hover:bg-[#5794f2]/85"
                  >
                    {passwordBusy ? (
                      <Loader2 className="mx-auto h-2.5 w-2.5 animate-spin" />
                    ) : (
                      'Change password'
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-[#9fa7b3]">
                  At least 12 characters. Changing it signs out every other
                  device.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/** PIN input - sirf digits, max 6 */
function PinField({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-[#9fa7b3]">
        {label}
      </Label>
      {/*
        RevealableInput, not a bare `<Input type="password">`.

        A PIN is SIX DIGITS. There is no length to feel, and a mistyped digit is
        invisible until the server rejects the whole attempt - at which point the
        natural conclusion is "my PIN was rejected" rather than "I transposed two
        characters". For a field this short, a reveal toggle is a correctness
        affordance rather than a convenience one.

        `inputMode="numeric"`, `maxLength={6}` and the digit-stripping `onChange`
        are all preserved - a revealed PIN must still only accept digits, or
        revealing it would introduce a way to submit something that was previously
        impossible.
      */}
      <RevealableInput
        id={id}
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={value}
        onValueChange={(v) => onChange(v.replace(/\D/g, ''))}
        placeholder="••••••"
        revealLabel={`Show ${label}`}
        hideLabel={`Hide ${label}`}
        className="h-10-[#2c3235] bg-[#0d0f11] font-mono tracking-widest"
      />
      {error ? <p className="text-[11px] text-amber-400">{error}</p> : null}
    </div>
  );
}

/** Toggle row - label + description + switch */
function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-[#0d0f11] p-3">
      <span className="shrink-0 text-[#9fa7b3]" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        <p className="text-[11px] text-[#9fa7b3]">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[#5794f2]' : 'bg-[#3d4348]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

