"use client";
import { useState, useEffect, Suspense } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { Bell, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';
import dynamic from 'next/dynamic';

const LazyAlertList = dynamic(() => import('@/components/alerts/alert-list'), {
  loading: () => <AlertListSkeleton />,
  ssr: false
});

type Alert = {
  id: string;
  state: 'firing' | 'resolved';
  severity: 'critical' | 'warning' | 'info';
  labels: {
    alertname: string;
    instance: string;
  };
  annotations: {
    summary: string;
    description: string;
  };
  startsAt: string;
  endsAt: string;
};

export default function DashboardRoute() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts().then(data => {
      setAlerts(data);
      setLoading(false);
    });
  }, []);

  const activeAlerts = alerts.filter(a => a.state === 'firing');
  const resolvedAlerts = alerts.filter(a => a.state === 'resolved');

  return (
    <div className="h-full">
      <div className="px-4 py-3 bg-[hsl(223_47%_11.2%)] border-b border-[hsl(217.2_32.6%_17.5%)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">Active Alerts</h2>
          <Badge variant={activeAlerts.length > 0 ? 'destructive' : 'default'} className="border-red-500/30">
            {activeAlerts.length} active
          </Badge>
        </div>
      </div>
      <div className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        {loading ? (
          <AlertListSkeleton />
        ) : (
          <Suspense fallback={<AlertListSkeleton />}>
            <LazyAlertList alerts={activeAlerts} />
          </Suspense>
        )}
      </div>
    </div>
  );
}

async function fetchAlerts(): Promise<Alert[]> {
  // In a real app, this would fetch from dashboard-service or webhook-receiver
  return [
    {
      id: 'alert-1',
      state: 'firing',
      severity: 'critical',
      labels: { alertname: 'HighMemoryUsage', instance: 'node-3' },
      annotations: { summary: 'Memory usage > 90% on node-3', description: 'Node memory usage has been above 90% for 2 minutes' },
      startsAt: '2026-09-20T10:30:00Z',
      endsAt: '0001-01-01T00:00:00Z',
    },
    {
      id: 'alert-2',
      state: 'firing',
      severity: 'warning',
      labels: { alertname: 'APIHighLatency', instance: 'api-1' },
      annotations: { summary: 'API 99th percentile latency > 1s', description: 'Latency has been high for 5 minutes' },
      startsAt: '2026-09-20T09:15:00Z',
      endsAt: '0001-01-01T00:00:00Z',
    },
    {
      id: 'alert-3',
      state: 'resolved',
      severity: 'warning',
      labels: { alertname: 'DatabaseSlowQueries', instance: 'db-1' },
      annotations: { summary: 'Database slow queries > 500ms', description: 'Query latency has returned to normal' },
      startsAt: '2026-09-20T08:00:00Z',
      endsAt: '2026-09-20T08:15:00Z',
    },
  ];
}

function AlertListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)]">
          <CardContent className="p-3">
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-3 w-2/3" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
