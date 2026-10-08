'use client';

// ONE session-aware user menu, shared by every app in the monorepo.
//
// =============================================================================
// WHY THIS IS SHARED AND NOT WRITTEN PER APP
// =============================================================================
//
// There were three different "who is logged in" answers, and none of them were
// real:
//
//   web root page  hardcoded <Link href="/auth/login"> + <Link href="/auth/register">
//                  - it never read the session, so it said "logged out" to
//                    everyone, always
//   web UserMenu   a static <img src="/placeholder.svg"> with hardcoded menu
//                  items, and a "Sign Out" that was a button with no handler
//   editor         actually worked, because its gate reads /api/session
//
// Two of the three were decoration. A user could be signed in and the page
// insisted they were not.
//
// So the component lives here, and every app renders the same thing from the same
// hook against the same `/api/session` shape. A fix lands in one place.
//
// =============================================================================
// WHY IT IS CLIENT-SIDE, AND WHY THAT IS STILL CORRECT
// =============================================================================
//
// The session cookie is `httpOnly`. Client JavaScript cannot read it - which is
// the entire point, and is why a `<script>` cannot steal it.
//
// What it CAN do is ask a server route that CAN read it. Every app exposes
// `/api/session`, which reads the cookie server-side, forwards the identity to
// auth-service, and returns the state. The browser never sees the token.
//
// The alternative - a server component reading `cookies()` and rendering the
// menu - is cheaper and works without JavaScript. It is also WRONG for this
// case: the menu has to open on click, and a server component cannot do that.
// The server read happens in the route; the interactivity happens here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutDashboard, LogIn, LogOut, User as UserIcon } from 'lucide-react';

/** The canonical state, matching the `/api/session` route on every app. */
export type SessionState =
  | 'loading'
  | 'out'
  | 'needs_verification'
  | 'needs_setup'
  | 'ready';

export interface SessionInfo {
  state: SessionState;
  email: string;
  role: string;
  /**
   * The one avatar the user uploaded, served by the app's own `/api/session`.
   *
   * Empty when they have not uploaded one, and the component falls back to
   * initials. That fallback is why the account menu could look "reasonable" for
   * months while a user who HAD uploaded a photo saw initials everywhere except
   * on their profile - the same person with two faces depending on the page.
   */
  avatarUrl: string;
}

const ANONYMOUS: SessionInfo = { state: 'out', email: '', role: '', avatarUrl: '' };

/** Read the session from this app's own `/api/session`. */
export function useSession(): SessionInfo & { refresh: () => Promise<void> } {
  const [session, setSession] = useState<SessionInfo>({ ...ANONYMOUS, state: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (!res.ok) {
        setSession({ ...ANONYMOUS, state: 'out' });
        return;
      }
      const body = (await res.json()) as Partial<SessionInfo>;
      setSession({
        state: body.state ?? 'out',
        email: body.email ?? '',
        role: body.role ?? 'user',
        avatarUrl: body.avatarUrl ?? '',
      });
    } catch {
      // Unreachable session route is treated as signed OUT, not signed in.
      // Failing open here would show a menu to someone nobody has identified.
      setSession({ ...ANONYMOUS, state: 'out' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...session, refresh };
}

/** `AB` from `a@b.com` - the fallback identity, same rule as the editor's. */
export function initialsOf(email: string): string {
  const name = (email.split('@')[0] ?? '').trim();
  if (!name) return '?';
  const parts = name.split(/[._-]+/).filter(Boolean);
  // `parts[0]`/`parts[1]` are `string | undefined` under
  // noUncheckedIndexedAccess even after a length check, so
  // bind them to locals and test both before indexing.
  const first = parts[0];
  const second = parts[1];
  // `charAt` always returns a string; index access would
  // be `string | undefined` under noUncheckedIndexedAccess.
  if (first && second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/**
 * The green ring is a live indicator and it pulses; the menu does not.
 *
 * A menu that animates in is decoration. An avatar whose ring pulses is a
 * statement about state, and it is the only animated thing in this component.
 *
 * `prefers-reduced-motion` collapses it to a static ring, because a pulsing
 * element is an accessibility problem for some people and the information
 * survives without the movement.
 */
function ringFor(ready: boolean): string {
  if (!ready) return 'ring-1 ring-sky-500/50';
  return 'ring-1 ring-green-500/70';
}

export interface SessionUserMenuProps {
  /** Where "sign in" goes. Defaults to this app's own auth page. */
  loginUrl?: string;
  registerUrl?: string;
  dashboardUrl?: string;
  /** Shown while the session is being read, so the header does not flash. */
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * SessionUserMenu - avatar when signed in, log in / register when not.
 *
 * Renders NOTHING while loading rather than guessing. A flash of "Log in" for a
 * signed-in user, immediately replaced by an avatar, is the exact bug this
 * component exists to remove.
 */
export function SessionUserMenu({
  loginUrl = '/auth/login',
  registerUrl = '/auth/register',
  dashboardUrl = '/dashboard',
  className = '',
  size = 'md',
}: SessionUserMenuProps) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Escape and outside-click both close it, because a menu a keyboard user
  // cannot leave is a menu they are trapped in.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      // Through this app's own route, so the cookie is cleared on the same origin
      // that set it. A cross-origin logout leaves a cookie the browser still
      // sends, which is the hardest kind of "logged out" to diagnose.
      await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' }).catch(
        () => undefined
      );
    } finally {
      setBusy(false);
      window.location.assign('/');
    }
  }, []);

  const dim = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const text = size === 'sm' ? 'text-[8px]' : 'text-[10px]';

  // ---- loading: render nothing rather than a guess ----
  if (session.state === 'loading') {
    return <div className={`${dim} shrink-0 rounded-full bg-white/5 ${className}`} aria-hidden="true" />;
  }

  // ---- signed out ----
  if (session.state === 'out') {
    return (
      <div className={`flex shrink-0 items-center gap-2 ${className}`}>
           <a
           href={loginUrl}
           className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 ${text} font-medium text-[#e8eaed] transition-colors hover:bg-[#ff6500]/10 hover:text-[#ff6500]`}
         >
           <LogIn className="h-2.5 w-2.5" aria-hidden="true" />
          Log in
        </a>
           <a
           href={registerUrl}
           className={`flex items-center justify-center gap-1.5 rounded-md bg-[#ff6500] px-3 py-2 ${text} font-semibold text-white transition-colors hover:bg-[#e55a00]`}
         >
          Register
        </a>
      </div>
    );
  }

  // ---- signed in, but not fully set up: still a real identity ----
  //
  // Shown as a smaller, warning-ringed avatar, because this person IS signed in -
  // they have simply not finished. Hiding the avatar would be a lie, and showing
  // the normal one would hide a problem they need to act on.
  const ready = session.state === 'ready';
  const pending = !ready;

  return (
    <div className={`relative shrink-0 ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${session.email}`}
        className={`relative flex ${dim} items-center justify-center rounded-full bg-sky-600 ${text} font-semibold uppercase tracking-wide text-white ${ringFor(ready)} transition-colors hover:bg-sky-500`}
      >
        {/*
          THE UPLOADED AVATAR, or initials.

          Not a choice between the two: an image when there is one, initials when
          there is not. The account menu used to always draw initials, so a user
          who had uploaded a photo saw the photo on their profile and letters
          everywhere else - the same person with two faces, which reads as a bug
          in the app rather than a missing feature.

          `onError` is what makes this safe against a BROKEN image URL: without
          it, a stale or deleted object renders as the browser's broken-image icon
          inside the ring, which looks worse than initials. One bad avatar should
          not put a hole in the header.
        */}
        {session.avatarUrl ? (
          <img
            src={session.avatarUrl}
            alt=""
            className="h-full w-full rounded-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span aria-hidden="true">{initialsOf(session.email)}</span>
        )}
        <span
          className={
            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 ' +
            'border-[#0a0a0a] motion-safe:animate-pulse ' +
            (ready ? 'bg-green-500' : 'bg-amber-500')
          }
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-50 w-60 rounded-md border-0 bg-[#1a1a1a] p-1 shadow-xl"
        >
          <div className="border-b border-muted/20 px-3 py-2">
            <p className="break-all text-[10px] font-medium text-[#e8eaed]">{session.email}</p>
            <p className="mt-0.5 text-[9px] capitalize text-[#8b949e]">
              {session.role}
              {pending ? ' · setup incomplete' : ''}
            </p>
          </div>

          <a
            href={dashboardUrl}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex h-8 items-center gap-2 rounded px-3 text-[10px] text-[#e8eaed] transition-colors hover:bg-white/5"
          >
            <LayoutDashboard className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            Dashboard
          </a>

          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            disabled={busy}
            className="flex h-8 w-full items-center gap-2 rounded px-3 text-[10px] text-[#e8eaed] transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            <LogOut className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>

          {/*
            Spelled out rather than left to a tooltip, because it is the
            consequence people get wrong: signing out here ends the session on
            THIS device only, and their other devices stay signed in. That
            distinction is the whole reason device-scoped logout was built.
          */}
          <p className="border-t border-muted/20 px-3 pb-2 pt-2 text-[9px] leading-relaxed text-[#8b949e]">
            Signing out ends this device only. Your other devices stay signed in.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export { UserIcon };
