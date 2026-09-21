import { Card, CardContent } from '@wideo11/ui/card';
import { Suspense, type HTMLAttributes } from 'react';
import dynamic from 'next/dynamic';

export const metadata = {
  title: 'Channels - Wideo11',
  description: 'Browse channels on Wideo11',
};

const LazyChannelGrid = dynamic(() => import('@/components/channels/channel-grid'), {
  loading: () => <ChannelGridSkeleton />,
  ssr: false,
});

export default function ChannelsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Channels</h1>
        <p className="text-gray-400 mt-1">Follow channels and creators</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <Suspense fallback={<ChannelCardSkeleton />}>
          <LazyChannelGrid />
        </Suspense>
      </div>
    </div>
  );
}

function ChannelGridSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <ChannelCardSkeleton key={i} />
      ))}
    </>
  );
}

function ChannelCardSkeleton() {
  return (
    <Card className="bg-gray-900/50 border-gray-800 overflow-hidden">
      <CardContent className="p-0">
        <Skeleton className="h-48 w-full bg-gray-700/50" />
        <div className="p-4 space-y-2">
          <Skeleton className="h-5 w-3/4 bg-gray-700/50" />
          <Skeleton className="h-4 w-full bg-gray-700/50" />
          <Skeleton className="h-3 w-1/2 bg-gray-700/50" />
        </div>
      </CardContent>
    </Card>
  );
}

function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`animate-pulse rounded-md ${className}`} />;
}
