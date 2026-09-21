import { useState } from 'react';
import { BarChart3, Plus, LayoutDashboard, Share2, Edit3, Trash2, Clock, Users } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@wideo11/ui/card';
import { Button } from '@wideo11/ui/button';
import { Badge } from '@wideo11/ui/badge';
import { Input } from '@wideo11/ui/input';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@wideo11/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@wideo11/ui/dropdown-menu';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

export const metadata = {
  title: 'Dashboards - Wideo11 Monitor',
  description: 'List of dashboards',
};

export default function DashboardsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);

  const { data: dashboards, isLoading } = useQuery({
    queryKey: ['dashboards-list'],
    queryFn: () => fetchDashboards(),
  });

  const filteredDashboards = (dashboards || []).filter(d => 
    d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.tags || []).some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-[calc(100vh-73px)] overflow-auto bg-[hsl(222.2_84%_6.1%)]">
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboards</h1>
            <p className="text-sm text-gray-400 mt-1">Manage and organize your dashboards</p>
          </div>
          <div className="flex items-center space-x-3">
            <div className="relative">
              <input
                type="text"
                placeholder="Search dashboards..."
                className="w-64 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button 
              className="bg-blue-600 hover:bg-blue-500"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="h-4 w-4 mr-1" /> New Dashboard
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredDashboards.map((dashboard) => (
            <DashboardCard key={dashboard.id} dashboard={dashboard} />
          ))}
        </div>

        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent className="bg-gray-800 border-gray-700 text-gray-100">
            <DialogHeader>
              <DialogTitle>Create New Dashboard</DialogTitle>
              <DialogDescription>Enter a name for your new dashboard</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm text-gray-300">Name</label>
                <input
                  type="text"
                  placeholder="Dashboard name"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white mt-1"
                />
              </div>
              <div>
                <label className="text-sm text-gray-300">Tags</label>
                <input
                  type="text"
                  placeholder="tag1, tag2, tag3"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white mt-1"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>
                Cancel
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-500">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function DashboardCard({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Card className="bg-gray-900/50 border-gray-800 hover:border-gray-700 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-gray-200 flex items-center">
            <LayoutDashboard className="h-4 w-4 mr-2 text-blue-400" />
            {dashboard.title}
          </CardTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-50 hover:opacity-100">
                <Settings className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-gray-800 border-gray-700">
              <DropdownMenuItem>
                <Edit3 className="h-4 w-4 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Share2 className="h-4 w-4 mr-2" /> Share
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem className="text-red-400">
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CardDescription className="text-xs text-gray-500 line-clamp-1">
          {dashboard.description || 'No description'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <Badge variant="secondary" className="text-xs">
            {dashboard.panels} panels
          </Badge>
          {dashboard.updatedAt && (
            <span className="text-xs text-gray-500">
              Updated {new Date(dashboard.updatedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface Dashboard {
  id: string;
  title: string;
  description?: string;
  panels: number;
  tags?: string[];
  updatedAt?: string;
}

async function fetchDashboards(): Promise<Dashboard[]> {
  return [
    {
      id: 'system-overview',
      title: 'System Overview',
      description: 'Infrastructure, services, and system health monitoring',
      panels: 8,
      tags: ['system', 'infrastructure'],
      updatedAt: '2026-09-20T10:30:00Z',
    },
    {
      id: 'business-metrics',
      title: 'Business Metrics',
      description: 'Revenue, users, engagement, and business KPIs',
      panels: 6,
      tags: ['business', 'analytics'],
      updatedAt: '2026-09-20T09:15:00Z',
    },
    {
      id: 'video-analytics',
      title: 'Video Analytics',
      description: 'Video views, watch time, engagement metrics',
      panels: 5,
      tags: ['video', 'analytics'],
      updatedAt: '2026-09-20T08:00:00Z',
    },
  ];
}
