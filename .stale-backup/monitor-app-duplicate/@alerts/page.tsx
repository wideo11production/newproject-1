"use client";
import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Bell, BellOff, CheckCircle2, AlertCircle } from 'lucide-react';

type Alert = {
  id: string;
  state: 'firing' | 'resolved';
  severity: string;
  labels: { alertname: string; instance: string };
  annotations: { summary: string; description: string };
  startsAt: string;
  endsAt: string;
};

export default function AlertsRoute() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlertHistory().then(data => {
      setAlerts(data);
      setLoading(false);
    });
  }, []);

  const filteredAlerts = alerts.filter(alert => {
    if (filter === 'all') return true;
    if (filter === 'firing') return alert.state === 'firing';
    if (filter === 'resolved') return alert.state === 'resolved';
    return true;
  });

  return (
    <div className="h-full">
      <div className="px-4 py-3 bg-[hsl(223_47%_11.2%)] border-b border-[hsl(217.2_32.6%_17.5%)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">Alert History</h2>
          <div className="flex space-x-1">
            {['all', 'firing', 'resolved'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2 py-1 rounded ${
                  filter === f 
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                    : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4 space-y-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)]">
                <CardContent className="p-3">
                  <div className="h-4 bg-gray-700 rounded w-3/4 mb-2 animate-pulse"></div>
                  <div className="h-3 bg-gray-700 rounded w-1/2 animate-pulse"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          filteredAlerts.map(alert => (
            <Card key={alert.id} className={`bg-[hsl(223_47%_11.2%)] border ${
              alert.state === 'firing' 
                ? 'border-red-500/30 bg-red-500/5' 
                : 'border-green-500/30 bg-green-500/5'
            }`}>
              <CardContent className="p-3">
                <div className="flex items-start space-x-3">
                  {alert.state === 'firing' ? (
                    <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <Badge 
                        variant={alert.state === 'firing' ? 'destructive' : 'default'}
                        className={alert.state === 'resolved' ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}
                      >
                        {alert.severity || 'unknown'}
                      </Badge>
                      <span className="text-xs text-gray-500">
                        {alert.startsAt ? new Date(alert.startsAt).toLocaleString() : 'Unknown time'}
                      </span>
                    </div>
                    <p className="font-medium text-white">{alert.labels?.alertname || 'Unknown alert'}</p>
                    {alert.annotations?.summary && (
                      <p className="text-sm text-gray-300 mt-1">{alert.annotations.summary}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

async function fetchAlertHistory(): Promise<Alert[]> {
  return [
    {
      id: '1',
      state: 'firing',
      severity: 'critical',
      labels: { alertname: 'HighMemoryUsage', instance: 'node-3' },
      annotations: { summary: 'Memory usage > 90% on node-3', description: 'Node memory usage has been above 90% for 2 minutes' },
      startsAt: '2026-09-20T10:30:00Z',
      endsAt: '0001-01-01T00:00:00Z',
    },
    {
      id: '2',
      state: 'firing',
      severity: 'warning',
      labels: { alertname: 'APIHighLatency', instance: 'api-1' },
      annotations: { summary: 'API 99th percentile latency > 1s', description: 'Latency has been high for 5 minutes' },
      startsAt: '2026-09-20T09:15:00Z',
      endsAt: '0001-01-01T00:00:00Z',
    },
    {
      id: '3',
      state: 'resolved',
      severity: 'warning',
      labels: { alertname: 'DatabaseSlowQueries', instance: 'db-1' },
      annotations: { summary: 'Database slow queries > 500ms', description: 'Query latency has returned to normal' },
      startsAt: '2026-09-20T08:00:00Z',
      endsAt: '2026-09-20T08:15:00Z',
    },
    {
      id: '4',
      state: 'firing',
      severity: 'warning',
      labels: { alertname: 'DiskSpaceLow', instance: 'node-1' },
      annotations: { summary: 'Disk space < 10% on node-1', description: '/var partition has less than 10% space left' },
      startsAt: '2026-09-20T07:45:00Z',
      endsAt: '0001-01-01T00:00:00Z',
    },
    {
      id: '5',
      state: 'resolved',
      severity: 'info',
      labels: { alertname: 'DeploymentComplete', instance: 'api-2' },
      annotations: { summary: 'Deployment completed successfully', description: 'v2.3.1 deployed to api-2' },
      startsAt: '2026-09-20T06:30:00Z',
      endsAt: '2026-09-20T06:32:00Z',
    },
  ];
}
