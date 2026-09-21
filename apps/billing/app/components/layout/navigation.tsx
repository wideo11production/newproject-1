'use client';

import Link from 'next/link';
import { LayoutDashboard, CreditCard, FileText, DollarSign, Settings, BarChart3, Users, Zap } from 'lucide-react';
import { cn, Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@wideo11/ui';

interface NavItemProps {
  href: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
}

function NavItem({ href, icon: Icon, label, active }: NavItemProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          className={cn(
            'flex items-center space-x-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            active
              ? 'bg-primary/10 text-primary border border-primary/20'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="bg-popover border-border">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function Navigation() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const navItems = [
    { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { href: '/dashboard', icon: BarChart3, label: 'Overview' },
    { href: '/subscriptions', icon: CreditCard, label: 'Subscriptions' },
    { href: '/invoices', icon: FileText, label: 'Invoices' },
    { href: '/payments', icon: DollarSign, label: 'Payments' },
    { href: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <TooltipProvider>
      <div className="p-4 space-y-1">
        <div className="mb-6 flex items-center space-x-2 px-3 py-2">
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground">Wideo11 Billing</span>
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
    </TooltipProvider>
  );
}