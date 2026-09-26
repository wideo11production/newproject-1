import type { Metadata } from 'next';
// Global font stack - Grafana-style system fonts (air-gapped, no network fetch)
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
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
        {children}
      </body>
    </html>
  );
}
