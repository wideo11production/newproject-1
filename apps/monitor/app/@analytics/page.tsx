"use client";
import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Activity, Database, Users, Globe, TrendingUp, Zap, type LucideIcon } from 'lucide-react';

type Metric = {
  id: string;
  name: string;
  value: string;
  unit: string;
  change: number;
  icon: LucideIcon;
  status: 'healthy' | 'warning' | 'critical';
};

export default function AnalyticsRoute() {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics().then(data => {
      setMetrics(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="h-full">
      <div className="px-4 py-3 bg-[hsl(223_47%_11.2%)] border-b border-[hsl(217.2_32.6%_17.5%)]">
        <h2 className="text-sm font-medium text-gray-400">Live Metrics</h2>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <MetricSkeleton key={i} />
            ))}
          </div>
        ) : (
          metrics.map(metric => (
            <MetricCard 
              key={metric.id}
              title={metric.name}
              value={metric.value}
              unit={metric.unit}
              change={metric.change}
              icon={metric.icon}
              status={metric.status}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  unit,
  change,
  icon: Icon,
  status,
}: Omit<Metric, 'name' | 'id'> & { title: string }) {
  const isPositive = change > 0;
  const statusColor = {
    healthy: 'text-green-400',
    warning: 'text-yellow-400',
    critical: 'text-red-400',
  }[status] || 'text-gray-400';

  return (
    <Card className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <CardTitle className="text-sm font-medium text-gray-300">{title}</CardTitle>
          <Icon className={`h-4 w-4 ${statusColor}`} />
        </div>
        <div className="flex items-baseline space-x-2">
          <span className="text-xl font-bold text-white">{value}</span>
          <span className="text-xs text-gray-500">{unit}</span>
          <Badge variant={isPositive ? 'default' : 'secondary'} className={`text-xs ${isPositive ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(change)}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricSkeleton() {
  return (
    <Card className="bg-[hsl(223_47%_11.2%)] border-[hsl(217.2_32.6%_17.5%)]">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="h-4 bg-gray-700 rounded w-24 animate-pulse"></div>
          <div className="h-4 w-4 bg-gray-700 rounded animate-pulse"></div>
        </div>
        <div className="flex items-baseline space-x-2">
          <div className="h-6 bg-gray-700 rounded w-16 animate-pulse"></div>
          <div className="h-4 bg-gray-700 rounded w-8 animate-pulse"></div>
        </div>
      </CardContent>
    </Card>
  );
}

async function fetchMetrics(): Promise<Metric[]> {
  return [
    { id: '1', name: 'CPU Usage', value: '42.5', unit: '%', change: 3.2, icon: Activity, status: 'healthy' },
    { id: '2', name: 'Memory Usage', value: '68.3', unit: '%', change: -1.5, icon: Database, status: 'warning' },
    { id: '3', name: 'Active Users', value: '1,247', unit: '', change: 12.8, icon: Users, status: 'healthy' },
    { id: '4', name: 'Request Rate', value: '12.4K', unit: '/s', change: 5.3, icon: Zap, status: 'healthy' },
    { id: '5', name: 'Global Requests', value: '256.7K', unit: '', change: 8.1, icon: Globe, status: 'healthy' },
    { id: '6', name: 'Error Rate', value: '0.24', unit: '%', change: -0.8, icon: TrendingUp, status: 'healthy' },
  ];
}
