'use client';

import { useSettings } from '../../lib/engine/settings';
import { Moon, Sun } from 'lucide-react';

export function Header() {
  const [settings, patch] = useSettings();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between bg-[#1a1a1a] px-4">
      {/* Left section: Logo/branding */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded bg-[#ff6500]" />
        <span className="text-[10px] font-medium text-white">AURA Micro-Frame Studio</span>
      </div>

      {/* Right section: User controls and theme toggle */}
      <div className="flex items-center gap-3">
        {/* Theme toggle - positioned near user avatar */}
        <button
          onClick={() => patch({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          aria-label={settings.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={`${settings.theme === 'dark' ? 'Light' : 'Dark'} theme
Persisted, so it survives a refresh like everything else here.`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:text-fg"
        >
          {settings.theme === 'dark' ? (
            <Sun className="h-2.5 w-2.5" aria-hidden="true" />
          ) : (
            <Moon className="h-2.5 w-2.5" aria-hidden="true" />
          )}
        </button>

        {/* User avatar and profile section */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-[#2a2a2a] flex items-center justify-center">
            <span className="text-[8px] text-white">U</span>
          </div>
          <span className="text-[8px] text-fg-secondary">User Profile</span>
        </div>
      </div>
    </header>
  );
}