"use client";

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
        <AdminClient>
          {children}
        </AdminClient>
      </body>
    </html>
  );
}