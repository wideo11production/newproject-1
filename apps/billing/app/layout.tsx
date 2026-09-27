import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import './globals.css';
import { ReactNode } from 'react';
// Google font REMOVED - air-gapped Grafana font stack use ho raha hai.
// Kyun: "next/font/google" build time par network se font fetch karta tha, aur
// network fail hone se build crash ho jati thi ("Failed to fetch Inter").
// Ab koi external font fetch nahi - system fonts native hain.
// Hinglish: Google font hata diya, ab system font stack hai - kabhi fail nahi hoga
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import { Navigation } from './components/layout/navigation';
import { Providers } from './components/providers';

export const metadata = {
  title: 'Wideo11 Billing',
  description: 'Payment & Billing System - Subscription management, invoicing, and payments',
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
        <Providers>
          <div className="flex h-screen overflow-hidden bg-background">
            <nav className="w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0">
              <Navigation />
            </nav>
            <main className="flex-1 overflow-auto min-w-0">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
