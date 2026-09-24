import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { config } from '@wideo11/config';
import { ReactNode, Suspense } from 'react';
import { ThemeToggle, UserMenu, Loading } from './components/header';
import Providers from './providers';

const inter = Inter({ subsets: ['latin'] });

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
  console.log("Config loaded:", { appUrl: config.NEXT_PUBLIC_APP_URL, buffer: config.MINIMUM_MAINTENANCE_BUFFER_INR, sisterShare: config.SISTER_SHARE_PERCENTAGE });
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className} suppressContentEditableWarning>
        <Providers>
          <div className="flex h-screen flex-col bg-gray-950">
            <header className="border-b border-gray-800 bg-gray-900/50">
              <div className="container mx-auto px-4 py-3 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <h1 className="text-xl font-bold text-white">Wideo11</h1>
                  <nav className="flex items-center space-x-2 text-sm">
                    <a href="/" className="text-gray-300 hover:text-white transition-colors">Home</a>
                    <a href="/dashboard" className="text-gray-300 hover:text-white transition-colors">Dashboard</a>
                    <a href="/browse" className="text-gray-300 hover:text-white transition-colors">Browse</a>
                    <a href="/channels" className="text-gray-300 hover:text-white transition-colors">Channels</a>
                  </nav>
                </div>
                <div className="flex items-center space-x-2">
                  <Suspense fallback={null}>
                    <ThemeToggle />
                  </Suspense>
                  <Suspense fallback={null}>
                    <UserMenu />
                  </Suspense>
                </div>
              </div>
            </header>
            
            <div className="flex-1 overflow-hidden">
              <main className="container mx-auto px-4 py-6 h-full overflow-auto">
                <Suspense fallback={<Loading />}>
                  {children}
                </Suspense>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}