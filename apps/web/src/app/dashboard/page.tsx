"use client"
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { BarChart3, Settings, Share2, Save, Plus, Layers, Activity, Bell, Users, Database } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import dynamic from 'next/dynamic';

function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function ToastViewport() {
  return null;
}

function Toast({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w- [&>*]:rounded-md">
      {children}
    </div>
  );
}

function ToastTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-semibold">{children}</div>;
}

function ToastDescription({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground">{children}</div>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

const LazyDashboardEditor = dynamic(
  () => import('@/components/dashboard/dashboard-editor'),
  {
    loading: () => <DashboardEditorSkeleton />,
    ssr: false,
  }
);

export const metadata = {
  title: 'Observability Dashboard - Wideo11',
  description: 'Custom Grafana-like observability dashboard with drag-drop panels',
};

interface StatCardData {
  title: string;
  value: string;
  change: string;
  icon: React.ElementType;
  iconColor: string;
}

const statCards: StatCardData[] = [
  { title: 'Total Requests', value: '12,543/s', change: '+12.5%', icon: Activity, iconColor: 'text-blue-400' },
  { title: 'Active Users', value: '342', change: '+5.2%', icon: Users, iconColor: 'text-green-400' },
  { title: 'Error Rate', value: '0.24%', change: '-0.8%', icon: BarChart3, iconColor: 'text-yellow-400' },
  { title: 'Latency', value: '42ms', change: '+3.1%', icon: Database, iconColor: 'text-purple-400' },
];

export default function DashboardPage() {
  const [dashboard, setDashboard] = useState({
    id: 'system-overview',
    title: 'System Overview',
    panels: [],
    timeRange: 'last_1h',
    refreshInterval: '5s',
  });
  const [toasts, setToast] = useState<Array<{ id: number; title: string; description: string }>>([]);

  const showToast = (title: string, description: string) => {
    const id = Date.now();
    setToast([...toasts, { id, title, description }]);
    setTimeout(() => {
      setToast(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  return (
    <ToastProvider>
      <div className="h-[calc(100vh-73px)] flex flex-col bg-gray-950">
        <header className="border-b border-gray-800 bg-gray-900/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white">
                  <BarChart3 className="h-5 w-5" />
                </Button>
              </Link>
              <h1 className="text-xl font-semibold text-white">{dashboard.title}</h1>
              <Badge variant="outline" className="border-gray-700 text-gray-400">
                {dashboard.panels.length} panels
              </Badge>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={dashboard.refreshInterval}
                onChange={(event) => setDashboard({ ...dashboard, refreshInterval: event.target.value })}
                className="w-32 rounded-md border border-gray-700 bg-gray-800/50 px-3 py-2 text-sm text-gray-300"
                aria-label="Refresh interval"
              >
                <option value="5s">5s</option>
                <option value="10s">10s</option>
                <option value="30s">30s</option>
                <option value="1m">1m</option>
                <option value="5m">5m</option>
              </select>
              <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
                <Share2 className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white hover:bg-gray-800">
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card, i) => (
            <DashboardStatCard key={i} card={card} />
          ))}
        </div>

        <main className="flex-1 overflow-hidden px-4 pb-4">
          <Suspense fallback={<DashboardEditorSkeleton />}>
            <LazyDashboardEditor
              dashboard={dashboard}
              onSave={(updated) => { setDashboard(updated); showToast('Success', 'Dashboard saved'); }}
              onUpdate={setDashboard}
            />
          </Suspense>
        </main>

        <ToastViewport />
        {toasts.map(toast => (
          <Toast key={toast.id}>
            <ToastTitle>{toast.title}</ToastTitle>
            <ToastDescription>{toast.description}</ToastDescription>
          </Toast>
        ))}
      </div>
    </ToastProvider>
  );
}

function DashboardStatCard({ card }: { card: StatCardData }) {
  const Icon = card.icon;
  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-300">{card.title}</CardTitle>
        <Icon className={`h-4 w-4 ${card.iconColor}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-white">{card.value}</div>
        <p className={`text-xs ${card.change.startsWith('+') ? 'text-green-400' : 'text-red-400'}`}>
          {card.change} from last period
        </p>
      </CardContent>
    </Card>
  );
}

function DashboardEditorSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="bg-gray-900/50 border-gray-800 animate-pulse">
          <CardHeader>
            <Skeleton className="h-4 w-3/4 bg-gray-700/50" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-40 w-full bg-gray-700/50" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
