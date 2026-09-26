import type { Metadata } from 'next';
// Google font REMOVED - air-gapped Grafana font stack use ho raha hai.
// Kyun: "next/font/google" build time par network se Inter fetch karta tha aur
// network fail hone se build crash ho jati thi ("Failed to fetch Inter" / ECONNRESET).
// Ye ek baar actually is project me build fail kar chuki hai.
// Ab koi external font fetch nahi - system fonts native hain, zero latency.
// Hinglish: Google font hata diya, ab system font stack hai - kabhi fail nahi hoga
import { FONT_SANS_CLASS, FONT_SANS_STACK } from '@wideo11/ui/font';
// Next.js processes this global stylesheet, even when TypeScript cannot resolve its declaration.
import './globals.css';
import { ReactNode, Suspense } from 'react';
import Providers from './providers';

function ThemeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const metadata: Metadata = {
  title: 'Wideo11 Video Editor',
  description: 'Professional video editor with templates, filters, animations and transitions',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={FONT_SANS_CLASS} style={{ fontFamily: FONT_SANS_STACK }} suppressContentEditableWarning>
        <ThemeProvider>
          <Providers>
            <div className="flex h-screen flex-col bg-background">
              <Suspense fallback={<Loading />}>
                {children}
              </Suspense>
            </div>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
    </div>
  );
}