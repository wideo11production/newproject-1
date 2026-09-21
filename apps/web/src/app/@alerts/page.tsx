import { Suspense, useState } from 'react';
import { Bell, AlertCircle, CheckCircle2, Clock, Filter, Search } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { Input } from '@wideo11/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@wideo11/ui/select';
import { Button } from '@wideo11/ui/button';
import { ScrollArea } from '@wideo11/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';

export default function AlertsRoute() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-gray-400">Alert History</h2>
          <div className="flex items-center space-x-2">
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-32 bg-gray-800/50 border-gray-700 text-gray-300">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <SelectItem value="all">All Alerts</SelectItem>
                <SelectItem value="firing">Firing</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-3 w-3 text-gray-500" />
              <Input
                placeholder="Search..."
                className="pl-7 w-48 bg-gray-800/50 border-gray-700 text-gray-300"
                value={search}
                onValueChange={setSearch}
              />
            </div>
          </div>
        </div>

        <Suspense fallback={<AlertsSkeleton />}>
          <AlertHistory filter={filter} search={search} />
        </Suspense>
      </div>
    </div>
  );
}

function AlertHistory({ filter, search }: { filter: string; search: string }) {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ['alerts-history', filter, search],
    queryFn: () => fetchAlerts(filter, search),
    refetchInterval: 30000,
  });

  if (isLoading) return <AlertsSkeleton />;

  const filteredAlerts = (alerts || []).filter(alert => {
    if (filter !== 'all' && alert.state !== filter) return false;
    if (search && !alert.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (filteredAlerts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No alerts match your criteria</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filteredAlerts.map((alert) => (
        <Card 
          key={alert.id} 
          className={`bg-gray-900/50 border ${
            alert.state === 'firing' 
              ? 'border-red-500/30 bg-red-500/5' 
              : 'border-green-500/30 bg-green-500/5'
          }`}
        >
          <CardContent className="p-3">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                {alert.state === 'firing' ? (
                  <AlertCircle className={`h-5 w-5 ${
                    alert.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'
                  }`} />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-white">{alert.name}</span>
                  <Badge variant={alert.state === 'firing' ? 'destructive' : 'default'}>
                    {alert.state}
                  </Badge>
                </div>
                {alert.description && (
                  <p className="text-sm text-gray-300 mb-1">{alert.description}</p>
                )}
                <div className="flex items-center space-x-4 text-xs text-gray-500">
                  <span className="flex items-center">
                    <Clock className="h-3 w-3 mr-1" />
                    {alert.startsAt}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    alert.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {alert.severity}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function fetchAlerts(filter: string, search: string) {
  return [
    {
      id: '1',
      name: 'HighMemoryUsage',
      state: 'firing',
      severity: 'critical',
      description: 'Memory usage > 90% on node-3 for 2+ minutes',
      startsAt: '2026-09-20T10:30:00Z',
    },
    {
      id: '2',
      name: 'APIHighLatency',
      state: 'firing',
      severity: 'warning',
      description: 'API 99th percentile latency > 1s for 5+ minutes',
      startsAt: '2026-09-20T09:15:00Z',
    },
    {
      id: '3',
      name: 'DatabaseSlowQueries',
      state: 'resolved',
      severity: 'warning',
      description: 'Database slow queries > 500ms, resolved 15m ago',
      startsAt: '2026-09-20T08:00:00Z',
    },
    {
      id: '4',
      name: 'DiskSpaceLow',
      state: 'firing',
      severity: 'warning',
      description: 'Disk space < 10% on node-1',
      startsAt: '2026-09-20T07:45:00Z',
    },
    {
      id: '5',
      name: 'LowActiveUsers',
      state: 'resolved',
      severity: 'info',
      description: 'Active user count below expected threshold',
      startsAt: '2026-09-20T06:30:00Z',
    },
  ];
}

function AlertsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50 border-gray-700">
          <CardContent className="p-3">
            <div className="flex items-start space-x-3">
              <Skeleton className="h-5 w-5 rounded-full bg-gray-700/50" />
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <Skeleton className="h-4 w-48 bg-gray-700/50" />
                  <Skeleton className="h-5 w-16 bg-gray-700/50" />
                </div>
                <Skeleton className="h-3 w-full bg-gray-700/50 mb-2" />
                <Skeleton className="h-3 w-2/3 bg-gray-700/50" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
