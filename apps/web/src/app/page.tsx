import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { Play, TrendingUp, Users, DollarSign, BarChart3 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { metadata } from './layout';

const LazyTrendingVideos = dynamic(() => import('@/components/home/trending-videos'), {
  loading: () => <TrendingVideosSkeleton />,
  ssr: false,
});

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="relative h-[300px] rounded-xl overflow-hidden">
        <Image
          src="/placeholder-hero.jpg"
          alt="Hero banner"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute bottom-6 left-6 space-y-3">
          <h2 className="text-4xl font-bold text-white">Discover amazing videos</h2>
          <p className="text-lg text-gray-300 max-w-md">
            Explore content from creators around the world
          </p>
        </div>
      </section>

      <section>
        <h3 className="text-lg font-semibold text-white mb-4">Quick Stats</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard 
            title="Total Views" 
            value="2.4M" 
            change="+12.5%" 
            icon={Play} 
            iconColor="text-blue-400"
          />
          <StatCard 
            title="Active Users" 
            value="1.2K" 
            change="+5.2%" 
            icon={Users} 
            iconColor="text-green-400"
          />
          <StatCard 
            title="Revenue" 
            value="$45.2K" 
            change="+8.1%" 
            icon={DollarSign} 
            iconColor="text-yellow-400"
          />
          <StatCard 
            title="Watch Time" 
            value="4.2K hrs" 
            change="-2.1%" 
            icon={TrendingUp} 
            iconColor="text-purple-400"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Trending</h3>
          <Link 
            href="/browse" 
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            View all
          </Link>
        </div>
        <Suspense fallback={<TrendingVideosSkeleton />}>
          <LazyTrendingVideos />
        </Suspense>
      </section>

      <section className="bg-gray-900/50 border border-gray-800 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-3">Go to Dashboard</h3>
        <p className="text-gray-400 text-sm mb-4">
          Navigate to the custom observability dashboard to view metrics, alerts, and analytics.
        </p>
        <Link href="/dashboard">
          <Button className="bg-blue-600 hover:bg-blue-500 text-white">
            Open Dashboard
          </Button>
        </Link>
      </section>
    </div>
  );
}

function StatCard({ title, value, change, icon: Icon, iconColor }) {
  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-400">{title}</p>
            <div className="text-2xl font-bold text-white mt-1">{value}</div>
            <p className={`text-xs mt-1 ${change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
              {change} from last month
            </p>
          </div>
          <div className={`p-2 bg-gray-800/50 rounded-lg ${iconColor}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TrendingVideosSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50 border-gray-800">
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
