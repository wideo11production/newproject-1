import './globals.css';
import type { Metadata } from 'next';
import { config } from '@wideo11/config';

export const metadata: Metadata = {
  title: 'Video Editor',
  description: 'Wideo11 Video Editor',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Log config for verification (server side)
  console.log("Config loaded:", { appUrl: config.NEXT_PUBLIC_APP_URL, buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR, sisterShare: config.SISTER_SHARE_PERCENTAGE });
  return (
    <html lang="en">
      <body className="flex flex-col h-screen bg-gray-900 text-gray-100">
        {children}
      </body>
    </html>
  );
}