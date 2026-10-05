// Superadmin app root layout
//
// Air-gapped Grafana font stack (no next/font/google - GKE builders par fetch timeout hota tha)
import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { PresenceTracker } from '@wideo11/ui/presence-tracker';
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import { themeInitScript } from '@wideo11/ui/theme';
import { ThemeProvider } from '@wideo11/ui/theme-toggle';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wideo11 Superadmin',
  description: 'Master control panel - security, clicks and user intelligence',
  // PWA install + home-screen icon. See `app/manifest.ts` for why the manifest and
  // the tab icon are two different files.
  manifest: '/manifest.webmanifest',
  //
  // ---- NO `icons:` KEY, AND THAT IS DELIBERATE ----
  //
  // This metadata used to declare:
  //
  //     icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] }
  //
  // which is a reasonable-looking line and it BROKE the tab icon.
  //
  // Next.js turns `app/icon.svg` into a CONTENT-HASHED URL automatically —
  // `/icon.svg?8f18ee004c68b569` — and the hash changes whenever the file
  // changes. That is the mechanism that makes an updated icon reach a browser
  // that has already cached the old one: new file, new hash, new URL, refetch.
  //
  // Declaring it by hand replaced that with the BARE url `/icon.svg`. The url is
  // now constant for the life of the app, so the browser cached whatever it
  // fetched first and had no reason to ever look again.
  //
  // The symptom was reported as "the 3008 tab icon is dull" — and it was dull,
  // because the browser was faithfully showing a cached copy of the pre-fix icon
  // while the server had been serving the new one all along. Verified directly:
  // the bytes on the wire had `stroke-width="5"` and `stroke-dasharray="46 117"`,
  // and a headless browser rendering those exact bytes measured 255/256 pixels of
  // contrast at 16px. The file was correct; the URL was frozen.
  //
  // `apps/web` never had this line, which is why its icon updated cleanly and this
  // one did not. So: let Next own the tag. The tab icon is `app/icon.svg`, the
  // install icon is `app/manifest.ts`, and neither is written by hand.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // ---- NO hardcoded `className="dark"` ----
    //
    // It used to be here, and it was inert: `globals.css` defined no `.dark` rule
    // and no `--app-*` variables, so the class selected nothing and the app was
    // dark purely because `body` had a hardcoded `background-color: #030712`.
    //
    // The pre-paint script below sets the class from storage or the OS preference
    // instead, which is what makes the toggle possible at all. `suppressHydration-
    // Warning` is still required: the server renders no class, the client adds one,
    // and React is right to notice and right to be told this is expected.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme BEFORE first paint.

          In `<head>`, inline, and not a component or an effect, because all three
          alternatives flash: a `useEffect` runs after paint, so a light-theme user
          sees a dark flash on every navigation. On a dashboard that is stared at
          for long stretches, a flash on every page load is the single most
          noticeable way to get theming wrong.

          Kept tiny and dependency-free for the same reason `theme.ts` documents it
          - it has to run before React exists, and it must not throw if storage is
          unavailable.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body
        className={`${FONT_SANS_CLASS} min-h-screen bg-gray-950 text-gray-100 antialiased`}
        style={{ fontFamily: FONT_SANS_STACK }}
        suppressContentEditableWarning
      >
        {/*
          ThemeProvider is a client component, so it cannot wrap `<html>` from a
          server layout. Wrapping `<body>`'s children is correct: the provider owns
          the toggle's state, and the pre-paint script has already set the class on
          `<html>` by the time this renders.
        */}
        <ThemeProvider>
          {/* Global activity capture (Awareness grid ka data source) */}
          <GlobalActivityTracker />
        {/* Presence heartbeat - feeds the superadmin Online Now panel. See the component's
            header: the server-side start/beat/end existed with zero callers, which is why
            every presence number read 0. */}
        <PresenceTracker />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
