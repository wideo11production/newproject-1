"use client";

import { GlobalActivityTracker } from '@wideo11/ui/activity-tracker';
import { PresenceTracker } from '@wideo11/ui/presence-tracker';

import './globals.css';
// Global font stack - Grafana-style system fonts (air-gapped, no network fetch)
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
import { config } from '@wideo11/config';
import { AdminClient } from './admin-client';

export default function Layout({ children }: { children: React.ReactNode }) {
  console.log("Config loaded:", { 
    appUrl: config.NEXT_PUBLIC_APP_URL, 
    buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR, 
    sisterShare: config.SISTER_SHARE_PERCENTAGE 
  });

  return (
    <html lang="en" className="h-full">
      <body className={`${FONT_SANS_CLASS} h-full bg-slate-950 text-slate-100 antialiased overflow-hidden`} style={{ fontFamily: FONT_SANS_STACK }}>
        {/* Global activity capture (Awareness grid ka data source) */}
        <GlobalActivityTracker />
        {/* Presence heartbeat - feeds the superadmin Online Now panel. See the component's
            header: the server-side start/beat/end existed with zero callers, which is why
            every presence number read 0. */}
        <PresenceTracker />
        <AdminClient>
          {children}
        </AdminClient>
      </body>
    </html>
  );
}
