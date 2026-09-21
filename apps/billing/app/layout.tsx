import './globals.css';
import { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import { Navigation } from './components/layout/navigation';
import { Providers } from './components/providers';

const inter = Inter({ subsets: ['latin'] });

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
      <body className={inter.className} suppressContentEditableWarning>
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
