import { Suspense } from 'react';
import { BarChart3, Activity, Bell, Database, Users, TrendingUp, DollarSign, Clock, Server } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Badge } from '@wideo11/ui/badge';
import { Skeleton } from '@wideo11/ui/skeleton';
import { Button } from '@wideo11/ui/button';
import Link from 'next/link';
import dynamic from 'next/dynamic';

export const metadata = {
  title: 'Wideo11 Monitor',
  description: 'Custom Observability Dashboard - Grafana alternative with drag-drop panels',
};

const LazyDashboardEditor = dynamic(
  () => import('./components/dashboard/dashboard-editor'),
  {
    loading: () => <DashboardEditorSkeleton />,
    ssr: false,
  }
);

export default function MonitorHome() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">System Overview</h1>
        <p className="text-sm text-gray-400 mt-1">
          Custom observability dashboard replacing Grafana
        </p>
      </div>

      <section>
        <h2 className="text-sm font-medium text-gray-400 mb-3">Quick Stats</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="Total Requests" 
            value="12.5K/s" 
            change="+12.5%" 
            icon={Activity} 
            iconColor="text-blue-400"
            bgColor="bg-blue-500/10"
            borderColor="border-blue-500/20"
          />
          <StatCard 
            title="Active Users" 
            value="342" 
            change="+5.2%" 
            icon={Users} 
            iconColor="text-green-400"
            bgColor="bg-green-500/10"
            borderColor="border-green-500/20"
          />
          <StatCard 
            title="Error Rate" 
            value="0.24%" 
            change="-0.8%" 
            icon={BarChart3} 
            iconColor="text-yellow-400"
            bgColor="bg-yellow-500/10"
            borderColor="border-yellow-500/20"
          />
          <StatCard 
            title="Revenue" 
            value="$45.2K" 
            change="+5.1%" 
            icon={DollarSign} 
            iconColor="text-purple-400"
            bgColor="bg-purple-500/10"
            borderColor="border-purple-500/20"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400">Active Dashboards</h2>
          <Link href="/dashboards">
            <Button variant="ghost" size="sm" className="text-gray-300 hover:text-white">
              View all
            </Button>
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <DashboardCard 
            title="System Overview" 
            description="Infrastructure, services, and system health"
            panels={4}
            icon={Activity}
          />
          <DashboardCard 
            title="Business Metrics" 
            description="Revenue, users, and business KPIs"
            panels={6}
            icon={BarChart3}
          />
          <DashboardCard 
            title="Video Analytics" 
            description="Views, watch time, and engagement metrics"
            panels={3}
            icon={Server}
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-gray-400">Quick Actions</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboards/new">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-500">
              + Create Dashboard
            </Button>
          </Link>
          <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white hover:bg-gray-800">
            <Bell className="h-4 w-4 mr-1" /> Alerts
          </Button>
          <Button size="sm" variant="ghost" className="text-gray-300 hover:text-white hover:bg-gray-800">
            <Database className="h-4 w-4 mr-1" /> Prometheus
          </Button>
        </div>
      </section>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  change, 
  icon: Icon, 
  iconColor, 
  bgColor, 
  borderColor 
}) {
  const isPositive = change.startsWith('+');
  
  return (
    <Card className={`bg-gray-900/30 border-gray-700`}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-300">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-white">{value}</div>
        <p className={`text-xs mt-1 ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
          {change} from last period
        </p>
      </CardContent>
    </Card>
  );
}

function DashboardCard({ title, description, panels, icon: Icon }) {
  return (
    <Card className="bg-gray-900/30 border-gray-700">
      <CardContent className="pt-6">
        <div className="flex items-center space-x-3 mb-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Icon className="h-5 w-5 text-blue-400" />
          </div>
          <CardTitle className="text-lg font-medium text-white">{title}</CardTitle>
        </div>
        <CardDescription className="text-sm text-gray-400">
          {description}
        </CardDescription>
        <div className="flex items-center justify-between mt-4">
          <Badge variant="outline" className="border-gray-700 text-gray-400">
            {panels} panels
          </Badge>
          <Link href="/dashboards/system-overview">
            <Button variant="link" size="sm" className="text-blue-400 p-0">
              Open
            </Button>
          </Link>
        </div>
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
