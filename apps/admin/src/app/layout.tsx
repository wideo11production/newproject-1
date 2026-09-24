"use client";

import './globals.css';
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
      <body className="h-full bg-slate-950 text-slate-100 antialiased overflow-hidden">
        <AdminClient>
          {children}
        </AdminClient>
      </body>
    </html>
  );
}