"use client";

import { Moon, Sun, User, LogOut, Settings, BarChart3, Activity, Bell, Users, Database, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Fingerprint, ShieldCheck, LogIn, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';
// The one real user menu in this monorepo. See the comment on `UserMenu`.
import { SessionUserMenu } from '@wideo11/ui/session-user-menu';
import WarningCirclePanel from '@/components/dashboard/warning-circle-panel';

type DropdownProps = {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
};

function DropdownMenu({ children }: DropdownProps) {
  return <details className="relative">{children}</details>;
}

function DropdownMenuTrigger({ children }: DropdownProps) {
  return <summary className="list-none cursor-pointer">{children}</summary>;
}

function DropdownMenuContent({ children, className = '', align = 'start' }: DropdownProps) {
  const position = align === 'end' ? 'right-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0';
  return <div className={`absolute z-50 mt-2 min-w-32 rounded-md p-1 shadow-md ${position} ${className}`}>{children}</div>;
}

function DropdownMenuItem({ children, className = '' }: DropdownProps) {
  return <button type="button" className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-700 ${className}`}>{children}</button>;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="text-gray-300 hover:text-ink hover:bg-gray-800"
    >
      <Sun className="h-2.5 w-2.5 dark:hidden" />
      <Moon className="h-2.5 w-2.5 hidden dark:block" />
    </Button>
  );
}

// =============================================================================
// UserMenu is the SHARED session menu, not a local one.
//
// It used to be a static block: a placeholder <img src="/placeholder.svg">, three
// hardcoded items, and a "Sign Out" that was a button with no handler - it
// looked like a user menu and did nothing. There was no logout route on this app
// at all, so there was nothing for it to call.
//
// It now renders `SessionUserMenu` from `@wideo11/ui`, which reads this app's
// `/api/session` and posts to `/api/auth/logout`. The editor renders the same
// component, so the two cannot drift apart again.
//
// The local DropdownMenu* primitives below are kept: other menus in this file
// still use them, and re-implementing them here would be the duplication this
// change exists to remove.
// =============================================================================
export function UserMenu() {
  return <SessionUserMenu dashboardUrl="/dashboard" className="" />;
}

export function SystemAlerts() {
  return <WarningCirclePanel showSystem="restricted" />;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8-2-500"></div>
    </div>
  );
}