import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import type { Metadata } from 'next';
// Google font REMOVED - air-gapped Grafana font stack use ho raha hai.
// Kyun: "next/font/google" build time par network se Inter fetch karta tha aur
// network fail hone se build crash ho jati thi ("Failed to fetch Inter" / ECONNRESET).
// Ye ek baar actually is project me build fail kar chuki thi.
// Ab koi external font fetch nahi - system fonts native hain, zero latency.
// Hinglish: Google font hata diya, ab system font stack hai - kabhi fail nahi hoga
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import './globals.css';
import { ReactNode } from 'react';
import Providers from './providers';
import { AppChrome } from '@/components/app-chrome';

export const metadata: Metadata = {
  title: 'Wideo11 - Video Platform',
  description: 'Premium video platform with custom observability dashboard',
};

export default function RootLayout({
  children,
  dashboard,
  analytics,
  alerts,
}: {
  children: ReactNode;
  dashboard: ReactNode;
  analytics: ReactNode;
  alerts: ReactNode;
}) {
  // Log config for verification (server side)
  console.log("Config loaded:", { appUrl: process.env.NEXT_PUBLIC_APP_URL, buffer: process.env.MINIMUM_MAINTENANCE_BUFFER_INR, sisterShare: process.env.SISTER_SHARE_PERCENTAGE });
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={FONT_SANS_CLASS} style={{ fontFamily: FONT_SANS_STACK }} suppressContentEditableWarning>
        {/* Global activity capture - har click/change persist hota hai.
            NOTE: ye <body> ke ANDAR hona zaroori hai - bahar rakhne par
            invalid HTML ban jata hai aur hydration fail hoti hai. */}
        <GlobalActivityTracker />
        <Providers>
          {/* Header + sidebar + main scroll container yahan se aata hai.
              Auth routes (/auth/*) pe ye khud render NAHI hota, warna dashboard
              chrome full-screen auth card ko cover kar deta tha. */}
          <AppChrome>{children}</AppChrome>
        </Providers>
      </body>
    </html>
  );
}