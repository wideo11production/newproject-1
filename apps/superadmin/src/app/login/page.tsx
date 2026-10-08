'use client';

// ---------------------------------------------------------------------------
// SUPERADMIN LOGIN — REDIRECT TO WEB APP
// ---------------------------------------------------------------------------
//
// The credential form used to live here, on this port. It has been removed
// in favour of the web app's own `/auth/login` page on port 3000.
//
// WHY: cookies are scoped by DOMAIN, not by port. `localhost:3008` and
// `localhost:3000` are one host to the browser, so signing in on port 3000
// sets a cookie that this app reads. There is no reason for this app to
// duplicate the form — and every duplicate is a second place for the
// lockout/PIN/security-setup flow to drift out of sync with the first.
//
// This file is kept as a redirect rather than deleted, so that any bookmark,
// runbook step, or `returnTo` target pointing at `/login` still resolves.
// ---------------------------------------------------------------------------

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function SuperadminLoginPage() {
  useEffect(() => {
    // Preserve a `next` target if one was passed, so an expired session
    // returns the operator to where they were rather than to `/`.
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next') ?? '/';
    // The web app's login page handles the same `next` parameter.
    window.location.replace(
      `http://localhost:3000/auth/login?next=${encodeURIComponent(next)}`
    );
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <Loader2 className="h-2.5 w-2.5 animate-spin text-gray-500" />
    </div>
  );
}