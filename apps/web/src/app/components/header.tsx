"use client";

import { Moon, Sun, User, LogOut, Settings, BarChart3, Activity, Bell, Users, Database, Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Fingerprint, ShieldCheck, LogIn, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@wideo11/ui/button';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';

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
  return <button type="button" className={`flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-gray-700 ${className}`}>{children}</button>;
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
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="h-4 w-4 hidden dark:block" />
    </Button>
  );
}

export function UserMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button variant="ghost" size="sm" className="text-gray-300 hover:text-ink hover:bg-gray-800">
          <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-gray-700 text-xs text-gray-300">
            <img src="/placeholder.svg" alt="User avatar" className="h-full w-full object-cover" />
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-gray-800 border-gray-700">
        <DropdownMenuItem>
          <User className="h-4 w-4 mr-2" /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Settings className="h-4 w-4 mr-2" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LogOut className="h-4 w-4 mr-2" /> Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
    </div>
  );
}