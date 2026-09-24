"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@wideo11/ui/toast';
import { TooltipProvider } from '@wideo11/ui/tooltip';

const queryClient = new QueryClient();

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}