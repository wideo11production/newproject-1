"use client"
import { Suspense, useState, useEffect } from 'react';
import { Activity, BarChart3, Bell, CheckCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { WebSocketClient } from '@/lib/websocket-client';
import { useQuery } from '@tanstack/react-query';

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md ${className}`} />;
}

export default function DashboardRoute() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        <h2 className="text-sm font-medium text-gray-400">System Health</h2>
        
        <Suspense fallback={<HealthSkeleton />}>
          <HealthChecks />
        </Suspense>

        <Suspense fallback={<MetricsSkeleton />}>
          <LiveMetrics />
        </Suspense>

        <Suspense fallback={<AlertsSkeleton />}>
          <RecentAlerts />
        </Suspense>
      </div>
    </div>
  );
}

function HealthChecks() {
  const { data: healthData, isLoading, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchHealth(),
    refetchInterval: 10000,
    staleTime: 5000,
  });

  if (isLoading) return <HealthSkeleton />;

  const checks = [
    { name: 'API Gateway', status: healthData?.api || 'unknown', icon: BarChart3 },
    { name: 'Auth Service', status: healthData?.auth || 'unknown', icon: CheckCircle },
    { name: 'Video Service', status: healthData?.video || 'unknown', icon: BarChart3 },
    { name: 'Wallet Service', status: healthData?.wallet || 'unknown', icon: Activity },
    { name: 'Push Service', status: healthData?.push || 'unknown', icon: Bell },
    { name: 'Redis Connection', status: healthData?.redis || 'unknown', icon: BarChart3 },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {checks.map((check) => {
        const Icon = check.icon;
        const isHealthy = check.status === 'healthy';
        const isDegraded = check.status === 'degraded';
        
        return (
          <Card key={check.name} className={`bg-gray-900/50 ${
            isHealthy ? 'border-green-500/30' : 
            isDegraded ? 'border-yellow-500/30' : 
            'border-red-500/30'
          }`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Icon className={`h-2.5 w-2.5 ${
                    isHealthy ? 'text-green-400' : 
                    isDegraded ? 'text-yellow-400' : 
                    'text-red-400'
                  }`} />
                  <span className="text-sm text-gray-300">{check.name}</span>
                </div>
                <Badge variant={isHealthy ? 'default' : isDegraded ? 'secondary' : 'destructive'}>
                  {check.status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

type Metric = {
  name: string;
  value: number;
};

function LiveMetrics() {
  const ws = WebSocketClient.getInstance();
  const [metrics, setMetrics] = useState<Metric[]>([]);
  
  useEffect(() => {
    ws.on('metric_update', (data) => {
      setMetrics(prev => {
        const newMetrics = [...prev];
        const idx = newMetrics.findIndex(m => m.name === data.name);
        if (idx >= 0) {
          newMetrics[idx] = data;
        } else {
          newMetrics.push(data);
        }
        return newMetrics;
      });
    });
    
    ws.connect('ws://localhost:8080/api/v1/ws');
    
    return () => ws.disconnect();
  }, [ws]);

  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-gray-300">Live Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {metrics.slice(0, 5).map((metric) => (
            <div key={metric.name} className="flex items-center justify-between">
              <span className="text-sm text-gray-300">{metric.name}</span>
              <div className="flex items-center space-x-2">
                <div className="w-24 bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${metric.value}%` }} />
                </div>
                <span className="text-xs text-gray-400 w-12 text-right">{metric.value}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentAlerts() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => fetchAlerts(),
    refetchInterval: 30000,
  });

  if (isLoading) return <AlertsSkeleton />;

  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-gray-300">Recent Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 overflow-y-auto">
          <div className="space-y-2">
            {alerts?.slice(0, 10).map((alert) => (
              <div key={alert.id} className="flex items-start space-x-2 text-sm">
                <div className={`mt-0.5 flex-shrink-0 w-2 h-2 rounded-full ${
                  alert.state === 'firing' ? 'bg-red-400' : 'bg-green-400'
                }`} />
                <div>
                  <span className="text-gray-300">{alert.name}</span>
                  <Badge variant={alert.state === 'firing' ? 'destructive' : 'default'} className="ml-2 text-xs">
                    {alert.state}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

async function fetchHealth() {
  return { api: 'healthy', auth: 'healthy', video: 'healthy', wallet: 'degraded', push: 'healthy', redis: 'healthy' };
}

async function fetchAlerts() {
  return [
    { id: '1', name: 'HighMemoryUsage', state: 'firing', severity: 'critical' },
    { id: '2', name: 'APIHighLatency', state: 'firing', severity: 'warning' },
    { id: '3', name: 'LowDiskSpace', state: 'resolved', severity: 'warning' },
  ];
}

function HealthSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50-800">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24 bg-gray-700/50" />
              <Skeleton className="h-5 w-12 bg-gray-700/50" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <Skeleton className="h-4 w-32 bg-gray-700/50" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <Skeleton className="h-3 w-20 bg-gray-700/50" />
              <Skeleton className="h-3 w-24 bg-gray-700/50" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AlertsSkeleton() {
  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <Skeleton className="h-4 w-32 bg-gray-700/50" />
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full bg-gray-700/50" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
