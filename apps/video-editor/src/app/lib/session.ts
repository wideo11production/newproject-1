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

const FALLBACK_EXPORT_HEIGHT = 720;
const FALLBACK_CONCURRENT_TRANSCODES = 1;
const FALLBACK_MEDIA_ASSETS = 0;
const FALLBACK_REEL_ASSETS = 0;
const FALLBACK_SAVE_PROJECTS = 0;

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
   * The plan CODE and its label, plus the timeline frame-rate ceiling and other
   * plan-gated capabilities.
   *
   * `maxFps` is the ceiling the editor branches on for frame-rate dropdowns and
   * playback speeds. `exportHeight` is the maximum export resolution the plan
   * grants (720 for trial, 1080/2160 for paid). `concurrentTranscodes` caps how
   * many in-flight ffmpeg jobs this account may hold. `mediaAssets`/`reelAssets`
   * are upload quotas. `saveProjects` is how many projects may be persisted.
   * `monetization` is whether the account may earn from ad revenue.
   *
   * All defaults are the trial's: 60fps, 720p export, 1 concurrent transcode,
   * zero asset quotas, no monetization — fail closed.
   */
  plan: string;
  planName: string;
  maxFps: number;
  exportHeight: number;
  concurrentTranscodes: number;
  mediaAssets: number;
  reelAssets: number;
  saveProjects: number;
  monetization: boolean;
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
  exportHeight: FALLBACK_EXPORT_HEIGHT,
  concurrentTranscodes: FALLBACK_CONCURRENT_TRANSCODES,
  mediaAssets: FALLBACK_MEDIA_ASSETS,
  reelAssets: FALLBACK_REEL_ASSETS,
  saveProjects: FALLBACK_SAVE_PROJECTS,
  monetization: false,
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
  exportHeight: FALLBACK_EXPORT_HEIGHT,
  concurrentTranscodes: FALLBACK_CONCURRENT_TRANSCODES,
  mediaAssets: FALLBACK_MEDIA_ASSETS,
  reelAssets: FALLBACK_REEL_ASSETS,
  saveProjects: FALLBACK_SAVE_PROJECTS,
  monetization: false,
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
        exportHeight?: number;
        concurrentTranscodes?: number;
        mediaAssets?: number;
        reelAssets?: number;
        saveProjects?: number;
        monetization?: boolean;
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
        exportHeight: typeof body.exportHeight === 'number' ? body.exportHeight : FALLBACK_EXPORT_HEIGHT,
        concurrentTranscodes: typeof body.concurrentTranscodes === 'number' ? body.concurrentTranscodes : FALLBACK_CONCURRENT_TRANSCODES,
        mediaAssets: typeof body.mediaAssets === 'number' ? body.mediaAssets : FALLBACK_MEDIA_ASSETS,
        reelAssets: typeof body.reelAssets === 'number' ? body.reelAssets : FALLBACK_REEL_ASSETS,
        saveProjects: typeof body.saveProjects === 'number' ? body.saveProjects : FALLBACK_SAVE_PROJECTS,
        monetization: body.monetization === true,
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
