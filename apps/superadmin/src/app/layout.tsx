// Superadmin app root layout
// Air-gapped Grafana font stack (no next/font/google - GKE builders par fetch timeout hota tha)
import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wideo11 Superadmin',
  description: 'Master control panel - security, clicks and user intelligence',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${FONT_SANS_CLASS} min-h-screen bg-gray-950 text-gray-100 antialiased`}
        style={{ fontFamily: FONT_SANS_STACK }}
      >
        {/* Global activity capture (Awareness grid ka data source) */}
        <GlobalActivityTracker />
        {children}
      </body>
    </html>
  );
}
