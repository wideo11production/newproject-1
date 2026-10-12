'use client';

/**
 * ============================================================================
 * DASHBOARD SIDEBAR  -  collapsible, icon-rail when collapsed
 * ============================================================================
 *
 * Do states me chalta hai:
 *   - EXPANDED   : icon + label (default)
 *   - COLLAPSED  : sirf icons (rail) - screen space bachata hai
 *
 * ---- RESPONSIVE STRATEGY ----
 *  - Desktop (lg+): user collapse kare ya na kare, sidebar rail hai
 *  - Mobile (<lg) : sidebar HAMESHA collapsed rehti hai aur slide-in hoti hai,
 *    kyunki chhoti screen pe expanded sidebar content ko dhak de leti hai.
 *    Mobile pe ek FAB / top-bar button se open-close hota hai.
 *
 * ---- ACCESSIBILITY ----
 *  - `<nav>` with `aria-label`
 *  - Collapse button: `aria-expanded` + `aria-controls`
 *  - Collapsed state me labels `sr-only` se screen readers ko milte rehte
 *    hain (sirf visually hidden) - icon-only UI se koi bhi accessibility
 *    information nahi choti
 *  - Active item `aria-current="page"`
 *  - Keyboard: normal tab order, Enter/Space se activate
 *
 * Hinglish comments: har block ka arth
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Upload,
  Youtube,
  Monitor,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@wideo11/ui/lib/utils';
import { BrandLockup } from '@wideo11/ui/brand/characters';

export type SidebarTab = {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
};

/** Dashboard ke saare tabs - ek jagah defined, sidebar aur mobile dono use karte hain */
export const DASHBOARD_TABS: SidebarTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/dashboard',
    icon: <LayoutDashboard className="h-2.5 w-2.5" />,
  },
  {
    id: 'upload',
    label: 'Upload',
    // The upload page (`/dashboard/upload`) is where media actually enters the
    // system. It existed with NO link to it for a while, which meant the whole
    // upload engine was reachable only by typing the URL - and a feature nobody
    // can navigate to is a feature nobody uses.
    //
    // Placed second, right after Overview: overview answers "what have I got",
    // and the very next thing a creator does is add something. Putting it below
    // Devices and Settings buried the primary action behind the secondary ones.
    href: '/dashboard/upload',
    icon: <Upload className="h-2.5 w-2.5" />,
  },
  {
    id: 'channels',
    label: 'Channels',
    href: '/dashboard#channels',
    icon: <Youtube className="h-2.5 w-2.5" />,
  },
  {
    id: 'devices',
    label: 'Devices',
    href: '/dashboard#devices',
    icon: <Monitor className="h-2.5 w-2.5" />,
  },
  {
    id: 'settings',
    label: 'Settings',
    // FIX: pehle ye `/settings` tha - jo apps/web me EXIST hi nahi karta
    // (wo route banaaya hi nahi gaya), isliye click karne par user ko
    // kuch galat mil raha tha. Ab ye USER ke apne settings hub par jaata
    // hai, jo ek hi page par profile + appearance + language + security +
    // content sab deta hai (requirement: "ek jagah, baar baar mat badlo").
    href: '/dashboard/settings',
    icon: <Settings className="h-2.5 w-2.5" />,
  },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  // ---- Desktop collapse state (user choice, browser me persist) ----
  //
  // NOTE: localStorage use hota hai taki page reload ke baad bhi choice
  // yaad rahe. `try/catch` zaroori hai - private browsing me localStorage
  // access THROW kar sakta hai, aur wo uncaught ho to app crash ho jayegi.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('wideo11.sidebar.collapsed');
      if (stored === '1') setCollapsed(true);
    } catch {
      /* storage unavailable - default (expanded) hi theek hai */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('wideo11.sidebar.collapsed', next ? '1' : '0');
      } catch {
        /* ignore - choice bas is session ke liye yaad rahegi */
      }
      return next;
    });
  };

  // ---- Route change pe mobile sidebar band ----
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ---- Hash change pe bhi band (tabs #channels / #devices anchor hain) ----
  useEffect(() => {
    const close = () => setMobileOpen(false);
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, []);

  /**
   * Active tab ka check.
   *
   * NOTE: hash anchors (`#channels`) ke liye pathname same rehta hai
   * (`/dashboard`), to hash ko bhi dekhna padta hai - warna Overview aur
   * Channels dono "active" dikhte.
   */
  const currentHash = typeof window !== 'undefined' ? window.location.hash : '';

  const isActive = (tab: SidebarTab): boolean => {
    const [path, hash] = tab.href.split('#');
    if (hash) {
      return currentHash === `#${hash}`;
    }
    // Path-based tab: exact match, ya nested path (future sub-pages)
    return pathname === path;
  };

  const nav = (
    <nav aria-label="Dashboard sections" className="flex flex-col gap-1 p-2">
      {DASHBOARD_TABS.map((tab) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? tab.label : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/50',
              active
                ? 'bg-[#1f2227] text-[#d8d9da]'
                : 'text-[#9fa7b3] hover:bg-[#1f2227]/60 hover:text-[#d8d9da]'
            )}
          >
            <span
              className={cn('shrink-0', active ? 'text-[#5794f2]' : 'text-[#9fa7b3]')}
              aria-hidden="true"
            >
              {tab.icon}
            </span>
            {/* Collapsed me visually chhupa, but screen reader ko dikhta hai -
                isse icon-only UI accessible rehta hai. */}
            <span className={cn('truncate', collapsed && 'sr-only')}>{tab.label}</span>
            {/* Active indicator - collapsed state me bhi dikhta hai */}
            {active ? (
              <span
                className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#5794f2]"
                aria-hidden="true"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* ---- Mobile: top bar + toggle ---- */}
      <div className="flex items-center justify-between-[#2c3235] bg-[#181b1f] px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="dashboard-sidebar"
          className="flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]"
        >
          <Menu className="h-2.5 w-2.5" aria-hidden="true" />
        </button>
        <span className="flex items-center gap-2">
          <BrandLockup size={22} />
          <span className="text-sm font-semibold text-[#d8d9da]">Wideo11</span>
        </span>
        {/* Spacer taaki 3-dot menu (right side) ke saath align ho.
            3-dot menu header me hi hai - is bar me nahi, isliye ye
            sirf visual balance ke liye hai. */}
        <span className="h-9 w-9" aria-hidden="true" />
      </div>

      {/* ---- Mobile: slide-in drawer ---- */}
      {mobileOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            id="dashboard-sidebar"
            className="fixed inset-y-0 left-0 z-50 w-64-[#2c3235] bg-[#181b1f] lg:hidden"
          >
            <div className="flex items-center justify-between-[#2c3235] px-3 py-2.5">
              <span className="flex items-center gap-2">
                <BrandLockup size={22} />
                <span className="text-sm font-semibold text-[#d8d9da]">Wideo11</span>
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="flex h-9 w-9 items-center justify-center rounded-md text-[#9fa7b3] transition-colors hover:bg-[#1f2227] hover:text-[#d8d9da]"
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </div>
            {nav}
          </div>
        </>
      ) : null}

      {/* ---- Desktop: fixed rail ---- */}
      <aside
        className={cn(
          'hidden shrink-0-[#2c3235] bg-[#181b1f] lg:flex lg:flex-col',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        {/* Brand */}
        <div
          className={cn(
            'flex h-14 shrink-0 items-center-[#2c3235]',
            collapsed ? 'justify-center px-2' : 'gap-2 px-4'
          )}
        >
          <BrandLockup size={22} />
          {!collapsed ? (
            <span className="truncate text-sm font-semibold text-[#d8d9da]">
              Wideo11
            </span>
          ) : null}
        </div>

        {nav}

        {/* Collapse toggle - bottom pe, taaki sidebar ke end me dikhe */}
        <div className="mt-auto-[#2c3235] p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="dashboard-sidebar-nav"
            className={cn(
              'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              'text-[#9fa7b3] hover:bg-[#1f2227]/60 hover:text-[#d8d9da]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5794f2]/50'
            )}
          >
            {collapsed ? (
              <ChevronsRight className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronsLeft className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            )}
            <span className={cn('truncate', collapsed && 'sr-only')}>Collapse</span>
          </button>
        </div>
      </aside>
    </>
  );
}
