import './globals.css';
import { ReactNode, Suspense } from 'react';
import { Inter } from 'next/font/google';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Navigation } from '@/components/layout/navigation';

const inter = Inter({ subsets: ['latin'] });

const queryClient = new QueryClient();

export const metadata = {
  title: 'Wideo11 Monitor',
  description: 'Custom Observability Dashboard - Grafana alternative with drag-drop panels',
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
  return (
    <html lang="en" className="dark">
      <body className={inter.className} suppressHydrationWarning>
        <QueryClientProvider client={queryClient}>
          <div className="flex h-screen overflow-hidden bg-[hsl(222.2_84%_6.1%)]">
            <nav className="w-64 border-r border-[hsl(217.2_32.6%_17.5%)] bg-[hsl(223_47%_11.2%)] overflow-y-auto">
              <Navigation />
            </nav>
            <main className="flex-1 overflow-auto">
              <Suspense fallback={<Loading />}>
                {dashboard}
              </Suspense>
            </main>
            <aside className="w-80 border-l border-[hsl(217.2_32.6%_17.5%)] bg-[hsl(223_47%_11.2%)] overflow-y-auto">
              <Suspense fallback={<Loading />}>
                {analytics}
              </Suspense>
            </aside>
          </div>
          <Suspense fallback={<Loading />}>
            {alerts}
          </Suspense>
        </QueryClientProvider>
      </body>
    </html>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-full space-x-2 text-gray-400">
      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
      <span>Loading...</span>
    </div>
  );
}
