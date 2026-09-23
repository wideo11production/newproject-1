'use client';

import { Skeleton } from '@wideo11/ui/skeleton';

export function Loading() {
  return (
    <div className="flex items-center justify-center h-full space-x-2 text-muted-foreground">
      <Skeleton className="h-6 w-6 rounded-full animate-pulse" />
      <span>Loading...</span>
    </div>
  );
}