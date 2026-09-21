import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ReactNode, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from '@wideo11/ui/toast';
import { TooltipProvider } from '@wideo11/ui/tooltip';

const inter = Inter({ subsets: ['latin'] });

const queryClient = new QueryClient();

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
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
            <ToastProvider>
              <TooltipProvider>
                <div className="flex h-screen flex-col bg-background">
                  <Suspense fallback={<Loading />}>
                    {children}
                  </Suspense>
                </div>
              </TooltipProvider>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
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