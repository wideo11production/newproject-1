// WorkspaceOverviewView — 📊 Universal landing area for all user roles.
//
// Hinglish: ye universal dashboard hai — sabhi roles (student, creator,
// monetized, subscriber) ke liye ek hi landing page. Stats cards +
// quick actions + recent activity.
//
// Data source: same-origin proxy API (auth-service se token attach kar ke).
// Client ke paas token KABHI nahi hota (httpOnly cookie use hota hai).

import { useEffect, useState } from 'react';
import { BarChart3, Users, Upload, DollarSign } from 'lucide-react';

type StatCard = {
  label: string;
  value: string;
  change: string;
  icon: React.ReactNode;
  color: string;
};

export function WorkspaceOverviewView() {
  const [stats, setStats] = useState<StatCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch workspace stats (same-origin proxy).
    void fetch('/api/workspace/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setStats([
          {
            label: 'Total Views',
            value: data.total_views?.toLocaleString() ?? '—',
            change: data.views_change ?? '',
            icon: <BarChart3 className="h-5 w-5" />,
            color: 'text-[#5794f2]',
          },
          {
            label: 'Subscribers',
            value: data.subscribers?.toLocaleString() ?? '—',
            change: data.subs_change ?? '',
            icon: <Users className="h-5 w-5" />,
            color: 'text-[#73bf69]',
          },
          {
            label: 'Uploads',
            value: data.total_uploads?.toLocaleString() ?? '—',
            change: data.uploads_change ?? '',
            icon: <Upload className="h-5 w-5" />,
            color: 'text-[#f2495c]',
          },
          {
            label: 'Revenue',
            value: data.revenue ? `₹${Number(data.revenue).toLocaleString()}` : '—',
            change: data.revenue_change ?? '',
            icon: <DollarSign className="h-5 w-5" />,
            color: 'text-[#f7c548]',
          },
        ]);
      })
      .catch(() => {
        // API not yet implemented — show placeholder stats.
        setStats([
          { label: 'Total Views', value: '0', change: '', icon: <BarChart3 className="h-5 w-5" />, color: 'text-[#5794f2]' },
          { label: 'Subscribers', value: '0', change: '', icon: <Users className="h-5 w-5" />, color: 'text-[#73bf69]' },
          { label: 'Uploads', value: '0', change: '', icon: <Upload className="h-5 w-5" />, color: 'text-[#f2495c]' },
          { label: 'Revenue', value: '₹0', change: '', icon: <DollarSign className="h-5 w-5" />, color: 'text-[#f7c548]' },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-6">
        <div className="h-6 w-48 animate-pulse rounded bg-[#1f2227]" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-[#d8d9da] mb-6">
        Workspace Overview
      </h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-[#9fa7b3]">
                  {stat.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-[#d8d9da]">
                  {stat.value}
                </p>
                {stat.change ? (
                  <p className="mt-1 text-xs text-[#9fa7b3]">{stat.change}</p>
                ) : null}
              </div>
              <span className={stat.color}>{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[#2c3235] bg-[#181b1f] p-5">
        <p className="text-sm text-[#9fa7b3]">
          Select a tab from the sidebar to navigate to a specific workspace.
        </p>
      </div>
    </div>
  );
}
