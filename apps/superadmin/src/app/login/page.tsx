'use client';

// The superadmin sign-in page.
//
// -----------------------------------------------------------------------------
// WHY THIS IS A PAGE AND NOT A FORM ON THE DASHBOARD
// -----------------------------------------------------------------------------
//
// It was a form on the dashboard, at `page.tsx`, rendered whenever
// `authState !== 'signed-in'`.
//
// That works, and it is the wrong shape for three reasons that only show up once
// somebody actually uses it:
//
//  1. IT IS NOT LINKABLE. There is no `/login` to send somebody to. "Open the
//     superadmin dashboard" cannot be a hyperlink, cannot go in a bookmark, cannot
//     be an incident-response runbook step, and cannot be the `returnTo` of a
//     session that expired on another tab.
//
//  2. IT LOSES THE URL. `page.tsx` handles `/`. Signing out and signing back in is
//     the same URL, so there is nothing to come back to and nothing to refresh.
//
//  3. IT PUTS THE SIGN-IN FORM ON EVERY ERROR. Any failure of `/api/session` - a
//     503 from auth-service, a network blip - renders the credential form. So a
//     transient upstream failure asks an already-signed-in operator for their
//     password, which reads as "I have been logged out" when nothing happened.
//
// A real page fixes all three, and it lets the dashboard be a dashboard.
//
// -----------------------------------------------------------------------------
// WHY THE CREDENTIAL NEVER TOUCHES JAVASCRIPT
// ------------------------------------------------------------------------------
//
// Email and password go to `POST /api/auth/login` on this app. That route forwards
// to auth-service server-side and puts the JWT in an httpOnly cookie. The token is
// never in a response body, so there is nothing for a script on this page to steal -
// which is the entire reason this replaced a box that asked the operator to paste a
// JWT they had to copy out of a `curl` response.

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert, Loader2, ArrowRight } from 'lucide-react';
import { ThemeToggle } from '@wideo11/ui/theme-toggle';

export default function SuperadminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // ---- Already signed in? Go straight through. ----
  //
  // Without this, `/login` is a dead end for somebody who is already authenticated:
  // it shows a form that will succeed and then do nothing visible. `router.replace`
  // rather than `push`, so the login page does not sit in history - otherwise Back
  // from the dashboard lands on a sign-in form for a session that exists.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/session', { cache: 'no-store' })
      .then((r) => {
        if (!cancelled && r.ok) router.replace('/');
      })
      .catch(() => {
        // Unreachable is not "signed out". Staying on the form is correct here.
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (busy) return;
      setBusy(true);
      setError('');

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
          errors?: Record<string, string>;
        };

        if (!res.ok) {
          // Three different failures with three different messages, because they
          // need three different actions:
          //   401 - the password is wrong, retype it
          //   503 - auth-service is down, do NOT retype anything
          //   400 - a field is malformed, fix that field
          // Collapsing them into "login failed" sends somebody to re-type a
          // password that was never the problem.
          setError(
            body.errors?.email ??
              body.errors?.password ??
              (res.status === 401
                ? 'Incorrect email or password.'
                : res.status === 503
                  ? 'The authentication service is unreachable. Try again shortly — your password is fine.'
                  : (body.message ?? body.error ?? `Sign-in failed (${res.status}).`))
          );
          return;
        }

        router.replace('/');
        router.refresh();
      } catch {
        setError('Could not reach this server. Check your connection.');
      } finally {
        setBusy(false);
      }
    },
    [busy, email, password, router]
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 py-10">
      {/* The theme toggle lives on the login screen too, not only behind the gate. */}
      <div className="fixed right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg">
            <ShieldAlert className="h-7 w-7 text-gray-50" />
          </div>
          <h1 className="text-xl font-bold text-gray-50">Superadmin</h1>
          <p className="mt-1 text-sm text-gray-400">
            Master control panel for Wideo11
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 shadow-2xl backdrop-blur">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm text-gray-300">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 w-full rounded-lg border border-gray-700 bg-gray-900 px-3.5 text-sm text-gray-50 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm text-gray-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-11 w-full rounded-lg border border-gray-700 bg-gray-900 px-3.5 text-sm text-gray-50 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-red-800/60 bg-red-950/40 p-3 text-xs leading-relaxed text-red-300"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>

        {/*
          What this screen does and does not do with the credential, stated on the
          screen itself. Not decoration: an operator who has been trained to expect
          a token box needs to know this is different and why, or they will assume
          it is the same flow with a different URL.
        */}
        <p className="mt-6 text-center text-xs leading-relaxed text-gray-500">
          Your credentials are posted to this server and exchanged for an{' '}
          <code className="rounded bg-gray-800 px-1 py-0.5">httpOnly</code> cookie. No
          token is pasted, stored, or readable by scripts.
        </p>
        <p className="mt-2 text-center text-xs text-gray-600">
          Sessions last 7 days and renew automatically.
        </p>
      </div>
    </div>
  );
}
