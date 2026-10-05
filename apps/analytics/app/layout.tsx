import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { PresenceTracker } from '@wideo11/ui/presence-tracker';
import { ReactNode, Suspense } from 'react';
// Google font REMOVED - air-gapped Grafana font stack use ho raha hai.
// Kyun: "next/font/google" build time par network se font fetch karta tha, aur
// network fail hone se build crash ho jati thi ("Failed to fetch Inter").
// Ab koi external font fetch nahi - system fonts native hain.
// Hinglish: Google font hata diya, ab system font stack hai - kabhi fail nahi hoga
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- BUG: ye import MISSING tha ----
//
// `globals.css` is layout me KABHI import hi nahi hui thi. Iska matlab:
//
//   - koi `<link rel="stylesheet">` HTML me emit nahi hui
//   - `document.styleSheets` empty tha (0 rules)
//   - har Tailwind class (`bg-background`, `text-foreground`, `border-border`)
//     ek no-op thi
//
// Page phir bhi render hota tha, har HTTP check 200 deta tha, aur app browser
// me poora UNSTYLED dikhta tha - bilkul wahi symptom jo monitor dashboard ka
// tha. Do alag wajah, ek hi dikhav: CSS compile nahi ho rahi thi.
//
// Yahan import karna hi kaafi hai - `postcss.config.mjs` (jo is app me bhi
// missing tha) ensure karta hai ki `@tailwind` directives actually compile
// hon. Dono chahiye: config compile karta hai, ye import attach karta hai.
import './globals.css';

import { Providers } from './components/providers';
import { Navigation } from './components/layout/navigation';

export const metadata = {
  title: 'Wideo11 Analytics',
  description: 'Analytics Engine & Creator Insights - Real-time analytics and creator performance tracking',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={FONT_SANS_CLASS} style={{ fontFamily: FONT_SANS_STACK }} suppressContentEditableWarning>
        {/* Global activity capture (Awareness grid ka data source) */}
        <GlobalActivityTracker />
        {/* Presence heartbeat - feeds the superadmin Online Now panel. See the component's
            header: the server-side start/beat/end existed with zero callers, which is why
            every presence number read 0. */}
        <PresenceTracker />
        <Providers>
          <div className="flex h-screen overflow-hidden bg-background">
            <nav className="w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0">
              <Navigation />
            </nav>
            <main className="flex-1 overflow-auto min-w-0">
              <Suspense fallback={<div className="flex h-full items-center justify-center">Loading...</div>}>{children}
              </Suspense>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
