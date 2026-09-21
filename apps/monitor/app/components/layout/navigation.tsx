import Link from 'next/link';
import { BarChart3, Activity, Bell, Settings, Users, Zap } from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@wideo11/ui/tooltip';

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
              ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              : 'text-gray-300 hover:bg-gray-800/50 hover:text-white'
          )}
        >
          <Icon className="h-5 w-5" />
          <span>{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="bg-gray-800 border-gray-700">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function Navigation() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';

  const navItems = [
    { href: '/', icon: BarChart3, label: 'Home' },
    { href: '/dashboards', icon: Activity, label: 'Dashboards' },
    { href: '/alerts', icon: Bell, label: 'Alerts' },
    { href: '/analytics', icon: BarChart3, label: 'Analytics' },
    { href: '/users', icon: Users, label: 'Users' },
    { href: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <div className="p-4 space-y-1">
      <div className="mb-6 flex items-center space-x-2 px-3 py-2">
        <Zap className="h-6 w-6 text-blue-400" />
        <span className="text-xl font-bold text-white">Wideo11 Monitor</span>
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
