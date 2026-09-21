'use client';

import { ReactNode } from 'react';
import { BarChart3, Users, TrendingUp, MousePointer, DollarSign, BookOpen } from 'lucide-react';

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
}

function NavItem({ href, icon: Icon, label, active }: NavItemProps) {
  return (
    <a
      href={href}
      className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${active
        ? 'bg-primary/10 text-primary border border-primary/20'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
    >
      <Icon className="h-5 w-5" />
      <span>{label}</span>
    </a>
  );
}

export function Navigation() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const navItems = [
    { href: '/analytics', icon: BarChart3, label: 'Dashboard' },
    { href: '/analytics/creator-insights', icon: Users, label: 'Creator Insights' },
    { href: '/analytics/retention', icon: TrendingUp, label: 'Retention' },
    { href: '/analytics/clickstream', icon: MousePointer, label: 'Clickstream' },
    { href: '/analytics/revenue', icon: DollarSign, label: 'Revenue' },
    { href: '/analytics/target-ledger', icon: BookOpen, label: 'Target Ledger' },
  ];

  return (
    <div className="p-4 space-y-1">
      <div className="mb-6 flex items-center space-x-2 px-3 py-2">
        <BarChart3 className="h-6 w-6 text-primary" />
        <span className="text-xl font-bold text-foreground">Wideo11 Analytics</span>
      </div>
      {navItems.map((item) => (
        <NavItem
          key={item.href}
          href={item.href}
          icon={item.icon}
          label={item.label}
          active={pathname === item.href}
        />
      ))}
    </div>
  );
}
