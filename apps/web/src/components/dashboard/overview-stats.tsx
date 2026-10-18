// ============================================================================
// DASHBOARD OVERVIEW STATS - Real-time statistics cards
// ============================================================================
// Shows all key metrics: uploads, views, earnings, subscribers, etc.
// Data comes from /api/dashboard/stats API endpoint.
// Hinglish: ye page user ke sabse important metrics dikhata hai.
// ============================================================================

'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  Users,
  Upload,
  DollarSign,
  Play,
  Clock,
  Eye,
} from 'lucide-react';
import {
  grafanaPrimary,
  grafanaSuccess,
  grafanaDanger,
  grafanaText,
  grafanaTextMuted,
  grafanaPanel,
  productPanelHover,
} from '@wideo11/ui/design-system';

interface StatCard {
  label: string;
  value: string;
  change: string;
  icon: React.ReactNode;
  color: string;
}

export function OverviewStats() {
  const [stats, setStats] = useState<StatCard[]>([
    { label: 'Total Views', value: '—', change: '', icon: <Eye className="h-2.5 w-2.5" />, color: grafanaPrimary },
    { label: 'Subscribers', value: '—', change: '', icon: <Users className="h-2.5 w-2.5" />, color: grafanaSuccess },
    { label: 'Uploads', value: '—', change: '', icon: <Upload className="h-2.5 w-2.5" />, color: grafanaDanger },
    { label: 'Revenue', value: '₹0', change: '', icon: <DollarSign className="h-2.5 w-2.5" />, color: productPanelHover },
    { label: 'Watch Time', value: '—', change: '', icon: <Clock className="h-2.5 w-2.5" />, color: grafanaTextMuted },
    { label: 'Play Time', value: '—', change: '', icon: <Play className="h-2.5 w-2.5" />, color: grafanaPrimary },
  ]);

  useEffect(() => {
    fetch('/api/dashboard/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setStats([
          { label: 'Total Views', value: data.total_views?.toLocaleString() ?? '0', change: data.views_change ?? '', icon: <Eye className="h-2.5 w-2.5" />, color: grafanaPrimary },
          { label: 'Subscribers', value: data.subscribers?.toLocaleString() ?? '0', change: data.subs_change ?? '', icon: <Users className="h-2.5 w-2.5" />, color: grafanaSuccess },
          { label: 'Uploads', value: data.total_uploads?.toLocaleString() ?? '0', change: data.uploads_change ?? '', icon: <Upload className="h-2.5 w-2.5" />, color: grafanaDanger },
          { label: 'Revenue', value: data.revenue ? `₹${Number(data.revenue).toLocaleString()}` : '₹0', change: data.revenue_change ?? '', icon: <DollarSign className="h-2.5 w-2.5" />, color: productPanelHover },
          { label: 'Watch Time', value: data.watch_time_hours ? `${data.watch_time_hours}h` : '—', change: data.watch_change ?? '', icon: <Clock className="h-2.5 w-2.5" />, color: grafanaTextMuted },
          { label: 'Play Time', value: data.play_time_hours ? `${data.play_time_hours}h` : '—', change: data.play_change ?? '', icon: <Play className="h-2.5 w-2.5" />, color: grafanaPrimary },
        ]);
      })
      .catch(() => {
        // Keep defaults
      });
  }, []);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 mb-8">
      {stats.map((stat) => (
        <div key={stat.label} className="p-5 rounded-xl border border-[#2a2a2a] bg-[#1e1e1e] hover:border-[#ff6500]/50 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${stat.color}20`}>
                {stat.icon}
              </div>
            </div>
          </div>
          <p className="text-sm font-medium text-[#e2e8f0]">{stat.label}</p>
          <p className="text-2xl font-bold text-white">{stat.value}</p>
          {stat.change && (
            <p className={`text-xs ${stat.change.startsWith('-') ? 'text-red-400' : 'text-green-400'}`}>
              {stat.change}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
