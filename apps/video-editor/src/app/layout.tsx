import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
// Next.js processes this global stylesheet, even when TypeScript cannot resolve its declaration.
import './globals.css';
import { ReactNode, Suspense } from 'react';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

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
      <body className={inter.className} suppressContentEditableWarning>
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