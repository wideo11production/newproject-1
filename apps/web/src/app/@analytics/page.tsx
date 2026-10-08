"use client"

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { BarChart3, Database, Users, Globe, Activity, TrendingUp, DollarSign, Clock, Play } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { useQuery } from '@tanstack/react-query';

export default function AnalyticsRoute() {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-6">
        <h2 className="text-sm font-medium text-gray-400">Live Analytics</h2>
        
        <Suspense fallback={<MetricsGridSkeleton />}>
          <AnalyticsMetrics />
        </Suspense>

        <Suspense fallback={<ChartSkeleton />}>
          <TrafficChart />
        </Suspense>
      </div>
    </div>
  );
}

function AnalyticsMetrics() {
  const { data: metrics, isLoading } = useQuery({
    queryKey: ['analytics-metrics'],
    queryFn: () => fetchAnalytics(),
    refetchInterval: 5000,
  });

  if (isLoading) return <MetricsGridSkeleton />;

  const metricsList = [
    { title: 'Views', value: 12543, unit: 'views', icon: Play, trend: '+12.5%' },
    { title: 'Watch Time', value: 4567, unit: 'hours', icon: Clock, trend: '+8.2%' },
    { title: 'Revenue', value: 45200, unit: 'USD', icon: DollarSign, trend: '+5.1%' },
    { title: 'Subscribers', value: 892, unit: 'new', icon: Users, trend: '+3.8%' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {metricsList.map((metric) => {
        const Icon = metric.icon;
        return (
          <Card key={metric.title} className="bg-gray-900/50-700">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">{metric.title}</span>
                <Icon className="h-2.5 w-2.5 text-gray-500" />
              </div>
              <div className="text-lg font-bold text-ink">{metric.value.toLocaleString()}</div>
              <Badge variant="secondary" className="text-xs mt-1 bg-green-500/10 text-green-400-500/20">
                {metric.trend}
              </Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function TrafficChart() {
  return (
    <Card className="bg-gray-900/50-700">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-gray-300">Real-time Traffic</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-32 flex items-end justify-between gap-1">
          {Array.from({ length: 30 }).map((_, i) => (
            <div 
              key={i} 
              className="bg-blue-500/80 hover:bg-blue-400 rounded-t transition-all flex-1"
              style={{ height: `${Math.random() * 80 + 20}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

async function fetchAnalytics() {
  return {
    views: 12543,
    watchTime: 4567,
    revenue: 45200,
    subscribers: 892,
  };
}

function MetricsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50-700">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <Skeleton className="h-3 w-16 bg-gray-700/50" />
              <Skeleton className="h-2.5 w-2.5 bg-gray-700/50" />
            </div>
            <Skeleton className="h-5 w-12 bg-gray-700/50" />
            <Skeleton className="h-3 w-10 mt-1 bg-gray-700/50" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <Card className="bg-gray-900/50-700">
      <CardHeader>
        <Skeleton className="h-4 w-24 bg-gray-700/50" />
      </CardHeader>
      <CardContent>
        <div className="h-32 flex items-end justify-between gap-1">
          {Array.from({ length: 30 }).map((_, i) => (
            <Skeleton key={i} className="bg-gray-700/50 flex-1" style={{ height: `${Math.random() * 80 + 20}%` }} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`animate-pulse rounded-md ${className ?? ''}`} style={style} />;
}
