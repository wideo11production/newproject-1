'use client';

// ============================================================================
// AccessGate - the editor's in-app sign-in gate
// ============================================================================
//
// WHAT THIS REPLACED
// -------------------
// The editor used to have a hard gate in `src/middleware.ts` that redirected
// every anonymous request to the web app's login page. That was strictly
// stronger, and it had one real advantage: an anonymous visitor never received
// a single byte of the editor.
//
// It also had a consequence nobody asked for. The editor's own toolbar has Log
// in and Sign up buttons - and with a middleware redirect in front of them,
// those buttons could never render for anyone who needed them. The editor was
// telling an anonymous visitor to sign in on a page it refused to show them.
// The user had to leave the app, authenticate somewhere else, and come back.
//
// With a session already in the cookie, the old middleware let the request
// through, so that inconsistency only ever showed up when signed out. It was
// still a wrong design: the sign-in affordance and the sign-in enforcement
// pointed at two different places.
//
// So the gate lives here now, next to the buttons it serves. The editor opens at
// its own URL, the toolbar renders, and the sign-in controls are actually
// reachable.
//
// ----------------------------------------------------------------------------
// WHAT THIS IS NOT
// ----------------------------------------------------------------------------
//
// This is not a security boundary, and it should not be mistaken for one.
//
// The editor's actual data - projects, media, the render/export pipeline - is
// already protected: every one of those calls goes to auth-service, which
// requires a bearer token it verifies, and returns 401 without one. An
// anonymous visitor can reach this UI and cannot do anything with it.
//
// What this gate does protect is the user's own experience: they are told
// plainly what is missing and what to do about it, instead of being silently
// redirected and losing their place.
//
// ----------------------------------------------------------------------------
// ORDERING
// ----------------------------------------------------------------------------
//
// The states are ordered, and the order is a security property, not a UI choice:
//
//   signed out  ->  email not verified  ->  security setup  ->  ready
//
// A 6-digit PIN is a real credential. Letting someone configure one on an
// account whose email address has not been proven is how account takeover
// happens, so verification is checked first and the setup step is never shown
// to someone who has not earned it.

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  Lock,
  LogIn,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';

const LOGIN_URL = process.env.NEXT_PUBLIC_LOGIN_URL ?? 'http://localhost:3000/auth/login';
const REGISTER_URL =
  process.env.NEXT_PUBLIC_REGISTER_URL ?? 'http://localhost:3000/auth/register';
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000/dashboard';
const VERIFY_URL = 'http://localhost:3000/auth/verify';
const SECURITY_SETUP_URL = 'http://localhost:3000/auth/security-setup';

type Gate =
  | { state: 'loading' }
  | { state: 'out' }
  | { state: 'needs_verification'; email: string }
  | { state: 'needs_setup'; email: string }
  | { state: 'ready'; email: string; role: string };

/**
 * Where the web app should send the user back to.
 *
 * This gate lives at the editor's root, so the only sensible destination is the
 * editor root. It is passed explicitly rather than trusted from a query string:
 * the value is a constant, so there is nothing here for a user to manipulate
 * into an open redirect.
 */
const BACK_TO_EDITOR = '/';

/** Attach the return destination to a web-app URL. */
function withNext(base: string, extra: Record<string, string> = {}): string {
  const url = new URL(base);
  url.searchParams.set('next', BACK_TO_EDITOR);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url.toString();
}

export function AccessGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ state: 'loading' });

  const probe = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (!res.ok) {
        // Could not determine the session. Showing the editor on a failed probe
        // would be a fail-open; showing the sign-in screen is the safe answer
        // and costs the user one click.
        setGate({ state: 'out' });
        return;
      }
      setGate((await res.json()) as Gate);
    } catch {
      setGate({ state: 'out' });
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

  // ---- ready: render the editor ----
  if (gate.state === 'ready') return <>{children}</>;

  // ---- loading: hold the frame, do not flash the editor ----
  //
  // A full-bleed spinner rather than a partial skeleton: the editor has no
  // meaningful "empty" state to show, so anything half-drawn would just be a
  // flash of a broken-looking timeline.
  if (gate.state === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="flex items-center gap-2 text-fg-muted" role="status">
          <Loader2 className="h-2 w-2 animate-spin" aria-hidden="true" />
          <span className="text-[8px]">Checking your session</span>
        </div>
      </div>
    );
  }

  const content = {
    out: {
      icon: <Lock className="h-2 w-2" aria-hidden="true" />,
      title: 'Sign in to open the editor',
      body: 'Your projects, media and exports are tied to your account. Sign in or create an account to continue.',
    },
    needs_verification: {
      icon: <MailCheck className="h-2 w-2" aria-hidden="true" />,
      title: 'Verify your email address',
      body: `We sent a verification link to ${gate.state === 'needs_verification' ? gate.email : ''}. Open it to confirm this address, then come back here.`,
    },
    needs_setup: {
      icon: <ShieldCheck className="h-2 w-2" aria-hidden="true" />,
      title: 'Finish your security setup',
      body: 'One more step before the editor opens: set a 6-digit PIN and answer three security questions. This protects your projects if the account is ever accessed from another device.',
    },
  }[gate.state as 'out' | 'needs_verification' | 'needs_setup'];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface p-6">
      <div className="w-full max-w-[360px] rounded-lg border border-edge bg-surface-raised p-5">
        <div className="mb-3 flex items-center gap-2 text-fg-muted">
          {content.icon}
          <span className="text-[8px] font-medium uppercase tracking-wider">
            Wideo11 Studio
          </span>
        </div>

        <h1 className="text-[10px] font-semibold text-fg">{content.title}</h1>
        <p className="mt-1.5 text-[8px] leading-relaxed text-fg-muted">{content.body}</p>

        <div className="mt-4 flex flex-col gap-1.5">
          {gate.state === 'out' && (
            <>
              <a
                href={withNext(REGISTER_URL)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface-overlay text-[8px] font-medium text-fg transition-colors hover:border-fg-muted"
              >
                <UserPlus className="h-2 w-2" aria-hidden="true" />
                Create an account
                <ArrowRight className="h-2 w-2" aria-hidden="true" />
              </a>
              <a
                href={withNext(LOGIN_URL)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge text-[8px] font-medium text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
              >
                <LogIn className="h-2 w-2" aria-hidden="true" />
                I already have an account
              </a>
            </>
          )}

          {gate.state === 'needs_verification' && (
            <>
              <a
                href={withNext(VERIFY_URL, { email: gate.email })}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface-overlay text-[8px] font-medium text-fg transition-colors hover:border-fg-muted"
              >
                <MailCheck className="h-2 w-2" aria-hidden="true" />
                Resend verification email
              </a>
              {/*
                The user opens the link in the SAME tab as the app, so this tab
                still has the old, pre-verification answer cached in its state.
                Without an explicit re-check the button would look like it did
                nothing, which reads as a broken button.
              */}
              <button
                type="button"
                onClick={() => void probe()}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge text-[8px] font-medium text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
              >
                <RefreshCw className="h-2 w-2" aria-hidden="true" />
                I have opened the link - check again
              </button>
            </>
          )}

          {gate.state === 'needs_setup' && (
            <>
              <a
                href={withNext(SECURITY_SETUP_URL)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge bg-surface-overlay text-[8px] font-medium text-fg transition-colors hover:border-fg-muted"
              >
                <ShieldCheck className="h-2 w-2" aria-hidden="true" />
                Continue to security setup
                <ArrowRight className="h-2 w-2" aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => void probe()}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-edge text-[8px] font-medium text-fg-muted transition-colors hover:bg-surface-overlay hover:text-fg"
              >
                <RefreshCw className="h-2 w-2" aria-hidden="true" />
                I have finished - check again
              </button>
            </>
          )}
        </div>

        <p className="mt-4 flex items-start gap-1.5 text-[8px] leading-relaxed text-fg-muted">
          <AlertTriangle className="mt-px h-2 w-2 shrink-0" aria-hidden="true" />
          <span>
            The editor is served to everyone, but nothing in it is readable
            without a valid session. Media, projects and exports stay on the
            server either way.
          </span>
        </p>

        <a
          href={DASHBOARD_URL}
          className="mt-3 inline-block text-[8px] text-fg-muted underline underline-offset-2 transition-colors hover:text-fg"
        >
          Go to dashboard instead
        </a>
      </div>
    </div>
  );
}
