import { Card, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const LazyVideoGrid = dynamic(() => import('@/components/browse/video-grid'), {
  loading: () => <VideoGridSkeleton />,
  ssr: false,
});

export const metadata = {
  title: 'Browse - Wideo11',
  description: 'Browse videos on Wideo11',
};

export default function BrowsePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Browse</h1>
        <p className="text-gray-400 mt-1">Discover videos, channels, and creators</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {['All', 'Videos', 'Channels', 'Playlists', 'Live', 'Trending'].map((cat) => (
          <Badge key={cat} variant="outline" className="border-gray-700 text-gray-300">
            {cat}
          </Badge>
        ))}
      </div>

      <Suspense fallback={<VideoGridSkeleton />}>
        <LazyVideoGrid />
      </Suspense>
    </div>
  );
}

function VideoGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50 border-gray-800 overflow-hidden">
          <CardContent className="p-0">
            <Skeleton className="aspect-video w-full bg-gray-700/50" />
            <div className="p-3 space-y-2">
              <Skeleton className="h-4 w-full bg-gray-700/50" />
              <Skeleton className="h-3 w-2/3 bg-gray-700/50" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md ${className}`} />;
}
