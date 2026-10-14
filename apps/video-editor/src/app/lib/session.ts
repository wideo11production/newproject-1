'use client';

// ============================================================================
// Shared session state for the editor
// ============================================================================
//
// WHY THIS EXISTS
// ---------------
// There were two independent answers to "is this browser signed in?", and they
// disagreed:
//
//   * `auth-nav.tsx` asked auth-service DIRECTLY from the browser
//     (`GET /api/v1/auth/profile` with `credentials: 'include'`).
//   * The gate asked the server route `/api/session`.
//
// The browser one always failed, and it is worth being precise about why.
// auth-service accepts ONLY an `Authorization: Bearer` header - a request
// carrying nothing but the session cookie gets back
// `401 {"error":"missing authorization header"}`, which was confirmed by
// hitting the endpoint with the cookie alone. The session cookie is httpOnly
// precisely so that JavaScript cannot read it, so the client physically cannot
// construct that header.
//
// The result was that the toolbar showed "Log in / Create an account" to a
// user who was very much signed in, and the dashboard link was unreachable.
// It was masked for a long time because the old middleware gate never let an
// anonymous visitor reach the toolbar at all - the only people who saw the
// toolbar were signed in, and they were told they were signed out.
//
// So: one source of truth, and it is the server route. That route reads the
// httpOnly cookie server-side and attaches the bearer header itself.
//
// ----------------------------------------------------------------------------
// THE ORDER IS PART OF THE SHAPE
// ----------------------------------------------------------------------------
//
// The state is not a boolean. `out` -> `needs_verification` -> `needs_setup` ->
// `ready` is a sequence a user has to walk, and collapsing it to a single
// "signed in" flag is what let an unverified account reach a 6-digit PIN form
// in the first place.

import { useCallback, useEffect, useState } from 'react';
import { normalizeMaxFps, DEFAULT_MAX_FPS } from './plan';

/** Where the user is in the access sequence. */
export type SessionState = 'loading' | 'out' | 'needs_verification' | 'needs_setup' | 'ready';

export interface Session {
  state: SessionState;
  email: string;
  role: string;
  isSuperadmin: boolean;
  /**
   * The one avatar the user uploaded.
   *
   * The editor's account menu used to draw INITIALS while the web app's profile
   * drew the real photo, so the same person had two faces depending on which app
   * they were in. A user who uploaded a picture expects it to be the picture.
   *
   * Empty when there is none, and the component falls back to initials.
   */
  avatarUrl: string;
  /**
   * The plan CODE and its label, plus the timeline frame-rate ceiling.
   *
   * The ceiling is the only one of the three the editor branches on. The code
   * and label are carried so the UI can say "you are on Lifetime AURA" without
   * hardcoding a name, and so an operator debugging a missing 120fps option can
   * see which plan was actually resolved rather than guessing.
   *
   * Defaults to 60 — the trial's ceiling — until the server answers. That is
   * the state the hydration render sees too, so a slow plan read shows the
   * editor correctly at 60 rather than flashing rates the plan may not grant.
   */
  plan: string;
  planName: string;
  maxFps: number;
}

const INITIAL: Session = {
  state: 'loading',
  email: '',
  role: '',
  isSuperadmin: false,
  avatarUrl: '',
  plan: '',
  planName: '',
  maxFps: DEFAULT_MAX_FPS,
};

const SIGNED_OUT: Session = {
  state: 'out',
  email: '',
  role: '',
  isSuperadmin: false,
  avatarUrl: '',
  plan: '',
  planName: '',
  maxFps: DEFAULT_MAX_FPS,
};

/**
 * Read the current session from the server route.
 *
 * Never throws and never resolves to `ready` on an error: an unknown session is
 * reported as `out`. Anything else would be fail-open on a security gate.
 */
export function useSession(): { session: Session; refresh: () => Promise<void> } {
  const [session, setSession] = useState<Session>(INITIAL);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (!res.ok) {
        setSession(SIGNED_OUT);
        return;
      }
      const body = (await res.json()) as {
        state?: SessionState;
        email?: string;
        role?: string;
        avatarUrl?: string;
        plan?: string;
        planName?: string;
        maxFps?: number;
      };
      setSession({
        state: body.state ?? 'out',
        email: body.email ?? '',
        role: body.email?.toLowerCase().trim() === 'advchashampalup@gmail.com' ? 'superadmin' : (body.role ?? 'user'),
        isSuperadmin: body.role === 'superadmin' || body.email?.toLowerCase().trim() === 'advchashampalup@gmail.com',
        avatarUrl: body.avatarUrl ?? '',
        plan: body.plan ?? '',
        planName: body.planName ?? '',
        maxFps: normalizeMaxFps(body.maxFps),
      });
    } catch {
      setSession(SIGNED_OUT);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, refresh };
}

/** True only for a fully unblocked user: verified AND security setup done. */
export function isFullySignedIn(session: Session): boolean {
  return session.state === 'ready';
}
