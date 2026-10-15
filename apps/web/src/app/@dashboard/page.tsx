"use client"
import { Suspense, useState, useEffect } from 'react';
import { Activity, BarChart3, Bell, CheckCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { WebSocketClient } from '@/lib/websocket-client';
import { useQuery } from '@tanstack/react-query';

interface Alert {
  id: string;
  name: string;
  state: 'firing' | 'resolved';
  severity: 'critical' | 'warning' | 'info';
  startsAt: string;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md ${className}`} />;
}

export default function DashboardRoute() {
  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
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
  const [fallback, setFallback] = useState<Metric[]>([]);

  useEffect(() => {
    let cancelled = false;
    // fetch-based fallback in case WS never emits metric_update
    void fetch('/api/analytics/summary', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        if (cancelled) return;
        const fb: Metric[] = [];
        const data = d as Record<string, unknown>;
        if (typeof data.views === 'number') fb.push({ name: 'views', value: data.views });
        if (typeof data.revenue === 'number') fb.push({ name: 'revenue', value: data.revenue });
        if (typeof data.subscribers === 'number') fb.push({ name: 'subscribers', value: data.subscribers });
        if (typeof data.watchTime === 'number') fb.push({ name: 'watchTime', value: data.watchTime });
        setFallback(fb);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

    ws.connect(process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080/api/v1/ws');

    return () => ws.disconnect();
  }, [ws]);

  const display = metrics.length > 0 ? metrics : fallback;

  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-gray-300">Live Metrics</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {display.slice(0, 5).map((metric) => (
            <div key={metric.name} className="flex items-center justify-between">
              <span className="text-sm text-gray-300">{metric.name}</span>
              <div className="flex items-center space-x-2">
                <div className="w-24 bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.max(5, Math.min(100, metric.value))}%` }} />
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

// RecentAlerts now also listens for real-time `alert_update` WebSocket events
// so the dashboard's alert list stays live, matching the WarningCirclePanel.
function RecentAlerts() {
  const ws = WebSocketClient.getInstance();
  const [socketAlerts, setSocketAlerts] = useState<Alert[]>([]);
  const { data: fetchedAlerts, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => fetchAlerts(),
    refetchInterval: 30000,
  });

  useEffect(() => {
    return ws.on('alert_update', (data: any) => {
      if (!data?.id || !data?.name) return;
      const liveAlert: Alert = {
        id: data.id,
        name: data.name,
        state: data.state,
        severity: data.severity,
        startsAt: data.startsAt || new Date().toISOString(),
      };
      setSocketAlerts((prev) => {
        if (liveAlert.state === 'resolved') return prev.filter((a) => a.id !== liveAlert.id);
        const without = prev.filter((a) => a.id !== liveAlert.id);
        return [liveAlert, ...without];
      });
    });
  }, [ws]);

  const showFetched = fetchedAlerts && fetchedAlerts.length > 0 && socketAlerts.length === 0;
  const displayAlerts = showFetched ? fetchedAlerts : socketAlerts;

  if (isLoading && socketAlerts.length === 0) return <AlertsSkeleton />;

  return (
    <Card className="bg-gray-900/50-800">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-gray-300">Recent Alerts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 overflow-y-auto">
          <div className="space-y-2">
            {displayAlerts?.slice(0, 10).map((alert) => (
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
  // Real, session-gated dependency read through the SHARED health handler
  // (`packages/ui/src/health-handler.ts`). Returns { status, checkedAt, services:[{service,status,latencyMs,code}] }.
  // The old version returned a hardcoded object with "wallet: degraded" and
  // "push: healthy" - pure fiction. We now map the real service statuses to the
  // card set this panel shows, and report anything the handler does not probe as
  // `unreachable` rather than inventing a state.
  const res = await fetch('/api/health-check', { cache: 'no-store' });
  if (!res.ok) {
    // A transient 503 from the relay (upstream unreachable) - surface every
    // service as unreachable so the panel stays truthful instead of green-washing.
    return { api: 'unreachable', auth: 'unreachable', video: 'unreachable', wallet: 'unreachable', push: 'unreachable', redis: 'unreachable' };
  }
  const data: { services?: Array<{ service: string; status: string }> } = await res.json().catch(() => ({}));
  const byService: Record<string, string> = {};
  for (const s of data.services ?? []) byService[s.service] = s.status;
  // Map the real probed services to the card labels. `video` = transcoding-service,
  // which this handler does not probe, so it stays unreachable until a probe entry
  // is added to health-handler.ts (see roadmap Phase 4).
  return {
    api: byService['auth'] ?? 'unreachable',
    auth: byService['auth'] ?? 'unreachable',
    video: byService['video'] ?? 'unreachable',
    wallet: byService['wallet'] ?? 'unreachable',
    push: byService['push'] ?? 'unreachable',
    redis: byService['redis'] ?? 'unreachable',
  };
}

async function fetchAlerts(): Promise<Alert[]> {
  // Real alert stream from webhook-receiver (AlertManager/Prometheus), proxied
  // through the session-gated /api/alerts relay. Replaces the hardcoded sample.
  const res = await fetch('/api/alerts', { cache: 'no-store' });
  if (!res.ok) return [];
  const data: { alerts?: any[] } = await res.json().catch(() => ({}));
  return (data.alerts ?? []).map((a) => ({
    id: String(a.id ?? a.fingerprint ?? ''),
    name: a.name ?? a.labels?.alertname ?? 'Unnamed',
    state: (a.state ?? 'firing') as 'firing' | 'resolved',
    severity: (a.severity ?? 'warning') as 'critical' | 'warning' | 'info',
    startsAt: a.startsAt ?? a.startsAt ?? new Date().toISOString(),
  }));
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
