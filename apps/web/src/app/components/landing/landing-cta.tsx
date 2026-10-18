'use client';

// The session-aware calls to action on the landing page.
//
// WHY A SEPARATE FILE, AND WHY `'use client'`
// -------------------------------------------
//
// `page.tsx` is a SERVER component - which is what you want for the landing page,
// because it ships no JavaScript for the content that matters to a crawler or to
// someone on a slow connection.
//
// The obvious edit is to call `useSession()` in `page.tsx` directly. That does not
// work, and it fails in a way that does not name itself: Next.js prerenders the
// page, hits a hook outside a client boundary, and the minifier reports
// `TypeError: (0, c.kP) is not a function` on a mangled name. The build error
// names no file and no line that helps.
//
// `SessionUserMenu` did work when imported into that page, because the "use
// client" on ITS file put the hook inside a client boundary. These CTAs need the
// same, so they live here instead - and `page.tsx` keeps its server rendering.

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@wideo11/ui/button';
import { initialsOf, useSession } from '@wideo11/ui/session-user-menu';

import {
  grafanaPanel,
  grafanaPrimaryBg,
  grafanaText,
  grafanaTextMuted,
  productPanelHover,
  productSeparation,
} from '@wideo11/ui/design-system';

// The editor's origin. The welcome CTA sends a signed-in creator straight there,
// which is the "dashboard is the service selector" idea rather than a second
// login page.
const EDITOR_URL = process.env.NEXT_PUBLIC_VIDEO_EDITOR_URL ?? 'http://localhost:3002';

/**
 * LandingCta - signup for a stranger, a welcome for a signed-in creator.
 *
 * The split is not cosmetic. Telling someone who already has an account to
 * "create your account" is how duplicate accounts get made, and the person most
 * annoyed by it is the one who already paid for a plan.
 *
 * Nothing renders while the session is being read. A flash of "Create your
 * account" that immediately becomes "Welcome back" is the exact artefact this
 * component exists to remove, so the loading state must not render either
 * version of the text.
 */
export function LandingCta() {
  const session = useSession();

  if (session.state === 'loading') {
    return <div className="h-9 w-40 shrink-0" aria-hidden="true" />;
  }

  // ---- SIGNED OUT: create account + log in ----
  //
  // Exactly what was asked for, and nothing more: a visitor gets the two things
  // they can do here.
  if (session.state === 'out') {
    return (
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <Link href="/auth/register?next=/" className="w-full sm:w-auto">
          <Button className={`w-full ${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85 sm:w-auto`}>
            Create account
          </Button>
        </Link>
        <Link href="/auth/login" className="w-full sm:w-auto">
          <Button
            variant="outline"
            className={`w-full ${grafanaText} ${productPanelHover} sm:w-auto`}
          >
            Log in
          </Button>
        </Link>
      </div>
    );
  }

  // ---- SIGNED IN: the avatar, a welcome, and the two places to go ----
  //
  // The avatar REPLACES the signup button rather than sitting next to it. Showing
  // "Create account" to someone who has an account is the thing this whole
  // component exists to stop, and the request was explicit: the create-account
  // slot becomes the person.
  const firstName = session.email.split('@')[0]?.split(/[._-]/)[0] ?? '';
  const name = firstName
    ? `${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`
    : session.email.split('@')[0];
  const needsSetup = session.state !== 'ready';

  return (
    <div className="flex w-full shrink-0 items-center gap-3 sm:w-auto">
      <LiveAvatar
        src={session.avatarUrl}
        alt=""
        fallback={initialsOf(session.email)}
        size="lg"
      />

      <div className="min-w-0">
        <p className={`truncate text-sm font-semibold ${grafanaText}`}>
          Welcome back, {name}
        </p>
        <p className={`truncate text-xs ${grafanaTextMuted}`}>
          {needsSetup
            ? 'Finish your security setup to unlock the editor.'
            : 'Your account is ready.'}
        </p>
      </div>

      <div className="ml-1 flex shrink-0 gap-2">
        <Link href="/dashboard" className="hidden sm:block">
          <Button className={`${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85`}>
            Dashboard
          </Button>
        </Link>
        <Link href={EDITOR_URL} className="hidden sm:block">
          <Button
            variant="outline"
            className={`${productSeparation} ${grafanaText} ${productPanelHover}`}
          >
            Editor
          </Button>
        </Link>
      </div>
    </div>
  );
}

/**
 * LiveAvatar - the uploaded picture inside a slowly revolving green ring.
 *
 * WHY THE RING TURNS
 * -------------------
 * A STATIC green ring would read as a status badge, and status badges carry
 * meaning. This one turns purely because the brief asked for it, and it is worth
 * being clear that it means nothing: it does not indicate a live session, a
 * verified account, or a healthy connection. A green ring is already used in the
 * header for "signed in", so reusing it here is consistent rather than decorative
 * for its own sake.
 *
 * THE ONE ACCESSIBILITY CONCERN, AND ITS ANSWER
 * ----------------------------------------------
 * An element that animates forever is a genuine problem for people with
 * `prefers-reduced-motion: reduce` - it is a common vestibular trigger, and this
 * component is in the header of every page.
 *
 * The answer is not to refuse the effect, it is to honour the preference: under
 * `reduce` the ring stops turning and becomes a static green outline. The
 * information (there is a person, they are signed in) is unchanged; only the
 * movement goes.
 *
 * THE MECHANISM
 * --------------
 * A `conic-gradient` masked by the avatar, on a wrapper that rotates. The
 * alternative - a spinning element behind the image - would cost a compositor
 * layer per avatar on every page. Masking is cheaper and cannot be seen to
 * glitch when the image loads.
 */
function LiveAvatar({
  src,
  alt,
  fallback,
  size = 'md',
}: {
  src: string;
  alt: string;
  fallback: string;
  size?: 'md' | 'lg';
}) {
  const [broken, setBroken] = useState(false);
  const dim = size === 'lg' ? 'h-14 w-14' : 'h-9 w-9';
  const text = size === 'lg' ? 'text-sm' : 'text-[10px]';

  return (
    <span className={`relative inline-flex ${dim} shrink-0`}>
      {/* The revolving light. Painted, never interactive. */}
      <span
        aria-hidden="true"
        className="absolute -inset-[3px] rounded-full motion-safe:animate-[spin_4s_linear_infinite]"
        style={{
          background:
            'conic-gradient(from 0deg, transparent 0deg, rgba(34,197,94,0) 200deg, rgba(34,197,94,0.95) 340deg, transparent 360deg)',
          WebkitMask:
            'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
          mask: 'radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))',
        }}
      />
      {/* A static outline, so there is a visible edge even before the mask paints
          and for anyone with reduced motion. */}
      <span
        aria-hidden="true"
        className="absolute -inset-[2px] rounded-full border border-[#ff6500]/50"
      />

      <span
        className={`relative z-10 flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-sky-600 font-semibold uppercase tracking-wide text-white ${text}`}
      >
        {src && !broken ? (
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover"
            // A stored URL can rot. Hiding the broken image leaves the initials
            // underneath, which is a graceful failure; leaving the browser's
            // broken-image glyph in the ring looks like a bug in the app.
            onError={() => setBroken(true)}
          />
        ) : (
          <span aria-hidden="true">{fallback}</span>
        )}
      </span>
    </span>
  );
}

/**
 * MidPageCta - the same split, further down the page.
 *
 * Worth having rather than leaving as a second registration prompt: a signed-in
 * visitor is very likely looking at the middle of the page, not the top, so
 * "Register now" there is just as wrong as it was in the hero.
 */
export function MidPageCta() {
  const session = useSession();
  const signedIn = session.state !== 'loading' && session.state !== 'out';

  return (
    <section className={`w-full-y ${grafanaPanel} px-4 py-12 sm:px-6 lg:px-8`}>
      <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-4 text-center">
        {signedIn ? (
          <>
            <h2 className={`text-xl font-bold tracking-tight ${grafanaText} sm:text-2xl`}>
              Pick up where you left off
            </h2>
            <p className={`max-w-xl text-sm ${grafanaTextMuted}`}>
              Your account is ready - there is nothing to sign up for again.
            </p>
            <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <Button className={`w-full ${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85 sm:w-auto`}>
                  Go to dashboard
                </Button>
              </Link>
              <Link href={EDITOR_URL} className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  className={`w-full ${grafanaText} ${productPanelHover} sm:w-auto`}
                >
                  Open editor
                </Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <h2 className={`text-xl font-bold tracking-tight ${grafanaText} sm:text-2xl`}>
              Ready to publish your first video?
            </h2>
            <p className={`max-w-xl text-sm ${grafanaTextMuted}`}>
              Create an account in under a minute. Free to start, no card required.
            </p>
            <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/auth/register?next=/" className="w-full sm:w-auto">
                <Button className={`w-full ${grafanaPrimaryBg} text-white ${grafanaPrimaryBg}/85 sm:w-auto`}>
                  Register now
                </Button>
              </Link>
              <Link href="/auth/login" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  className={`w-full ${grafanaText} ${productPanelHover} sm:w-auto`}
                >
                  Log in
                </Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
