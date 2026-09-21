import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart3, Plus, Clock, Share2, Settings } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Button, buttonVariants } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Separator } from '@wideo11/ui/separator';
import { Tooltip, TooltipTrigger, TooltipContent } from '@wideo11/ui/tooltip';
import dynamic from 'next/dynamic';

const LazyDashboardEditor = dynamic(() => import('@/components/dashboard/dashboard-editor'), {
  loading: () => <DashboardEditorSkeleton />,
  ssr: false
});

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch the default dashboard
    fetchDashboard('default').then(data => {
      setDashboard(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="border-b border-[hsl(217.2_32.6%_17.5%)] px-4 py-3 bg-[hsl(223_47%_11.2%)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <BarChart3 className="h-5 w-5 text-blue-400" />
            <h1 className="text-lg font-semibold text-white">
              {dashboard?.title || 'Loading dashboard...'}
            </h1>
            <Badge variant="outline" className="border-gray-700 text-gray-400">
              {dashboard?.panels?.length || 0} panels
            </Badge>
          </div>
          <div className="flex items-center space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
                  <Clock className="h-4 w-4 mr-1" /> Last 1h
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-gray-800 border-gray-700">
                <p>Time range</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="bg-gray-800 border-gray-700">
                <p>Settings</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4">
        <Suspense fallback={<DashboardEditorSkeleton />}>
          {dashboard ? (
            <LazyDashboardEditor dashboard={dashboard} onUpdate={setDashboard} />
          ) : (
            <DashboardEditorSkeleton />
          )}
        </Suspense>
      </main>
    </div>
  );
}

interface DashboardPanel {
  id: string;
  type: 'timeseries' | 'stat' | 'table' | 'bar' | 'pie' | 'logs' | 'alerts' | 'geomap' | 'heatmap';
  title: string;
  gridPos: { x: number; y: number; w: number; h: number };
  targets: Array<{
    expr: string;
    legendFormat?: string;
    refId?: string;
  }>;
  options: Record<string, unknown>;
  data?: unknown;
}

interface Dashboard {
  id: string;
  title: string;
  uid?: string;
  tags?: string[];
  panels: DashboardPanel[];
  time: {
    from: string;
    to: string;
  };
  refresh?: string;
  variables?: Array<{
    name: string;
    type: string;
    query: string;
    current?: { text: string; value: string };
  }>;
  timepicker?: {
    time_options: string[];
    refresh_intervals: string[];
  };
  schemaVersion?: number;
  version?: number;
  links?: Array<{ title: string; url: string }>;
}

async function fetchDashboard(id: string): Promise<Dashboard> {
  // In a real app, this would call the dashboard-service API
  // The backend should be at: http://dashboard-service.wideo11.com/api/v1/dashboards/:id
  // Or: http://gateway.wideo11.com/dashboard-service/api/v1/dashboards/:id
  
  // For now, return mock data simulating what the dashboard-service would return
  return {
    id: id,
    title: 'System Overview',
    uid: 'system-overview',
    tags: ['system', 'infrastructure', 'default'],
    refresh: '5s',
    time: {
      from: 'now-1h',
      to: 'now'
    },
    timepicker: {
      time_options: ['5m', '15m', '1h', '6h', '12h', '24h', '2d', '7d', '30d'],
      refresh_intervals: ['5s', '10s', '30s', '1m', '5m', '15m', '30m', '1h', '2h', '1d']
    },
    schemaVersion: 39,
    version: 1,
    variables: [
      {
        name: 'datacenter',
        type: 'query',
        query: 'label_values(up, datacenter)',
        current: { text: 'All', value: '$__all' }
      },
      {
        name: 'instance',
        type: 'query',
        query: 'label_values(up, instance)',
        current: { text: 'All', value: '$__all' }
      }
    ],
    panels: [
      {
        id: 'panel-1',
        type: 'stat',
        title: 'Total Requests',
        gridPos: { x: 0, y: 0, w: 4, h: 4 },
        targets: [{ expr: 'sum(rate(http_requests_total[5m]))', legendFormat: 'Requests/sec' }],
        options: { colorMode: 'value', graphMode: 'none', justifyMode: 'auto' },
        data: { value: 12543, label: 'requests/sec', change: 12.5 }
      },
      {
        id: 'panel-2',
        type: 'timeseries',
        title: 'CPU Usage',
        gridPos: { x: 4, y: 0, w: 8, h: 6 },
        targets: [{ expr: '100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)', legendFormat: '{{instance}}' }],
        options: { fillOpacity: 10, lineWidth: 1, pointSize: 5 }
      },
      {
        id: 'panel-3',
        type: 'stat',
        title: 'Active Users',
        gridPos: { x: 12, y: 0, w: 4, h: 4 },
        targets: [{ expr: 'sum(gauges_active_users_total)', legendFormat: 'Active users' }],
        options: { colorMode: 'value', graphMode: 'none', justifyMode: 'auto' },
        data: { value: 342, label: 'users', change: -2.1 }
      },
      {
        id: 'panel-4',
        type: 'bar',
        title: 'Top Endpoints by Latency',
        gridPos: { x: 12, y: 4, w: 4, h: 6 },
        targets: [{ expr: 'topk(5, histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, path)))', legendFormat: '{{path}}' }],
        options: { orientation: 'horizontal' }
      },
      {
        id: 'panel-5',
        type: 'alerts',
        title: 'Active Alerts',
        gridPos: { x: 0, y: 6, w: 8, h: 6 },
        targets: [],
        options: {},
        data: [
          { state: 'firing', labels: { alertname: 'HighMemoryUsage', severity: 'warning' }, annotations: { summary: 'Memory usage > 90% on node-3' }, startsAt: '2026-09-20T10:30:00Z' },
          { state: 'firing', labels: { alertname: 'APIHighLatency', severity: 'critical' }, annotations: { summary: 'API 99th percentile latency > 1s' }, startsAt: '2026-09-20T09:15:00Z' },
          { state: 'resolved', labels: { alertname: 'DatabaseSlowQueries', severity: 'warning' }, annotations: { summary: 'Database slow queries > 500ms' }, startsAt: '2026-09-20T08:00:00Z' },
        ]
      },
      {
        id: 'panel-6',
        type: 'logs',
        title: 'Recent Logs',
        gridPos: { x: 8, y: 6, w: 8, h: 6 },
        targets: [{ expr: '{job="wideo11-api"}', legendFormat: '' }],
        options: { enableLogDetails: true, wrapLogMessage: false }
      },
      {
        id: 'panel-7',
        type: 'pie',
        title: 'Traffic by Region',
        gridPos: { x: 0, y: 12, w: 6, h: 5 },
        targets: [{ expr: 'sum by(region) (http_requests_total)', legendFormat: '{{region}}' }],
        options: {}
      },
      {
        id: 'panel-8',
        type: 'heatmap',
        title: 'Request Rate Distribution',
        gridPos: { x: 6, y: 12, w: 6, h: 5 },
        targets: [{ expr: 'sum(rate(http_requests_total[5m])) by (status_code)', legendFormat: '{{status_code}}' }],
        options: {}
      },
      {
        id: 'panel-9',
        type: 'table',
        title: 'Top Videos by Views',
        gridPos: { x: 12, y: 6, w: 4, h: 6 },
        targets: [{ expr: 'topk(10, video_views_total)', legendFormat: '{{title}}' }],
        options: {}
      },
    ]
  };
}

function DashboardEditorSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)] animate-pulse">
          <CardHeader>
            <CardTitle className="text-sm text-gray-600">Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-32 bg-gray-800/50 rounded"></div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}