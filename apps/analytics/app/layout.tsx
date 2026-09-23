import { ReactNode, Suspense } from 'react';
import { Inter } from 'next/font/google';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Providers } from './components/providers';
import { Navigation } from './components/layout/navigation';

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Wideo11 Analytics',
  description: 'Analytics Engine & Creator Insights - Real-time analytics and creator performance tracking',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={inter.className} suppressContentEditableWarning>
        <Providers>
          <div className="flex h-screen overflow-hidden bg-background">
            <nav className="w-64 border-r border-border bg-card overflow-y-auto flex-shrink-0">
              <Navigation />
            </nav>
            <main className="flex-1 overflow-auto min-w-0">
              <Suspense fallback={<div className="flex h-full items-center justify-center">Loading...</div>}>{children}
              </Suspense>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
