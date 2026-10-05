import type { Metadata } from 'next';
// Global font stack - Grafana-style system fonts (air-gapped, no network fetch)
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
// Click ledger ka data source (Awareness grid isi ko padhta hai).
//
// Ye baaki saat apps me mounted hai; currency app chhoot gaya tha - iska apna
// koi tracker nahi tha aur koi `/api/audit` route bhi nahi, to is app ki koi
// bhi activity ledger me nahi jaati thi. Currency rates dikhna ek real user
// journey hai (multi-currency phase 9 ka hissa), to uska data chahiye.
import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { PresenceTracker } from '@wideo11/ui/presence-tracker';
import './globals.css';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Wideo11 Currency',
  description: 'Multi-currency exchange rates - updated every 24 hours',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={FONT_SANS_CLASS} style={{ fontFamily: FONT_SANS_STACK }}>
        <GlobalActivityTracker />
        {/* Presence heartbeat - feeds the superadmin Online Now panel. See the component's
            header: the server-side start/beat/end existed with zero callers, which is why
            every presence number read 0. */}
        <PresenceTracker />
        {children}
      </body>
    </html>
  );
}
