// App chrome - header + sidebar + main scroll container.
//
// KYUN YE ALAG COMPONENT HAI:
// Pehle ye markup seedha root `layout.tsx` me tha, to SAARE pages - landing,
// browse, auth sab - dashboard console chrome ke andar render hote the. Result:
//   - landing page par sidebar ("NAVIGATION / Dashboard / Analytics") aata tha,
//     jo marketing page par bilkul out-of-place hai
//   - wo sidebar `absolute top-0 z-10` hai, isliye header ke upar chadh jaata
//     tha aur "Home" / "Wideo11" title ko cover kar deta tha
//   - landing page apna KHUD ka header bhi render karta hai (`page.tsx` me
//     `<header>`), to do header ek saath dikhte the
//   - auth pages par bhi ye chrome aa raha tha, jabki wo full-screen focused
//     card hain
//
// AB: chrome sirf un routes pe render hota hai jo SACH me observability
// console hain. Baaki pages apna layout khud dete hain (landing/browse/
// channels/ads apna header rakhte hain, auth AuthShell use karta hai).
//
// NOTE: parallel route slots (@dashboard / @analytics / @alerts / @settings) are
// destructured in the root layout and passed in here so the real console panels
// mount inside this shell instead of the empty <div/> segment stubs.
// On any route only the slot matching that route is non-null (the rest resolve to
// their default.tsx -> null), so rendering all four in <main> is safe.
//
// Hinglish comments: har block ka arth

'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import {
  ThemeToggle,
  UserMenu,
  Loading,
  SystemAlerts,
} from '@/app/components/header';
import { BarChart3, Activity, Bell, Settings, HelpCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import {
  surfaceRaised,
} from '@wideo11/ui/design-system';

/**
 * Sirf ye routes par dashboard console chrome (sidebar + header) dikhta hai.
 *
 * Ye Wideo11 ka internal observability console hai - ise public marketing
 * pages, catalog pages ya auth pages pe dikhana galat tha.
 *
 * Naya route console banwana ho to yahan add karo.
 *
 * ---- FIX: `/dashboard` REMOVED from this list ----
 * `/dashboard` ab CREATOR ka home hai (profile + channels + devices), koi
 * admin/console page nahi. Ye list me rehne se kya hota tha:
 *
 *   AppChrome admin sidebar (NAVIGATION / Dashboard / Analytics / Alerts /
 *   Settings) + apna header render karta, aur creator dashboard apna header
 *   bhi render karta. dono ek ke upar ek - visible overlap, aur page
 *   SUPERADMIN jaisa dikhta tha jabki wo user ka apna dashboard tha.
 *
 * Ab `/dashboard` list se bahar hai, isliye creator dashboard standalone
 * render hota hai (bilkul auth pages ki tarah) - koi double nav nahi.
 *
 * Console pages (Analytics / Alerts / Settings) abhi bhi AppChrome ke andar
 * hain, aur creator dashboard se ek "Console" link unhe pahunchata hai.
 */
const CONSOLE_ROUTES = ['/analytics', '/alerts', '/settings'];

function isConsoleRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return CONSOLE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

export function AppChrome({
  children,
  dashboard,
  analytics,
  alerts,
  settings,
}: {
  children: ReactNode;
  dashboard?: ReactNode;
  analytics?: ReactNode;
  alerts?: ReactNode;
  settings?: ReactNode;
}) {
  const pathname = usePathname();

  // Public / marketing / auth page: page apna layout khud handle karta hai.
  // Koi header ya sidebar nahi - warna dono ek dusre ko overlap karte hain.
  if (!isConsoleRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      {/* BORDERLESS DESIGN: Header separator uses ${surfaceRaised} (rich charcoal) contrast
          against main area bg-gray-950 instead of a hard. Visual hierarchy
          maintained through background color difference, not lines. */}
      <header className={`${surfaceRaised}`}>
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-ink">Wideo11</h1>
            <nav className="flex items-center space-x-2 text-sm">
              <a
                href="/dashboard"
                className="text-gray-300 transition-colors hover:text-ink"
              >
                Dashboard
              </a>
              <a
                href="/analytics"
                className="text-gray-300 transition-colors hover:text-ink"
              >
                Analytics
              </a>
              <a
                href="/alerts"
                className="text-gray-300 transition-colors hover:text-ink"
              >
                Alerts
              </a>
              <a
                href="/settings"
                className="text-gray-300 transition-colors hover:text-ink"
              >
                Settings
              </a>
            </nav>
          </div>
          <div className="flex items-center space-x-2">
            {/* System Alerts - Warning Circle Panel for restricted system alerts */}
            <Suspense fallback={null}>
              <SystemAlerts />
            </Suspense>
            {/* Help Dropdown */}
            <details className="relative">
              <summary className="list-none cursor-pointer flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:text-ink rounded-md">
                <HelpCircle className="h-2.5 w-2.5" />
                Help
              </summary>
              <div className="absolute z-50 mt-2 right-0 min-w-48 rounded-md bg-gray-800 p-1 shadow-lg border border-gray-700">
                <Link
                  href="/workspace/help/micro-frame-guide"
                  className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-300 hover:text-ink hover:bg-gray-700 rounded-md"
                >
                  <ExternalLink className="h-2.5 w-2.5" />
                  AURA Micro-Frame Studio Walkthrough
                </Link>
              </div>
            </details>
            <Suspense fallback={null}>
              <ThemeToggle />
            </Suspense>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {/* BORDERLESS DESIGN: Sidebar separator uses ${surfaceRaised} (rich charcoal)
          instead of. Main content area has no visible separator -
          the background contrast between sidebar and main provides the
          visual division. */}
        <aside className={`absolute left-0 top-0 z-10 hidden h-full w-64 ${surfaceRaised}/90 backdrop-blur-sm md:block`}>
          <div className="p-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Navigation
              </h3>
              <nav className="space-y-1">
                <a
                  href="/dashboard"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <BarChart3 className="h-2.5 w-2.5" />
                  Dashboard
                </a>
                <a
                  href="/analytics"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Activity className="h-2.5 w-2.5" />
                  Analytics
                </a>
                <a
                  href="/alerts"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Bell className="h-2.5 w-2.5" />
                  Alerts
                </a>
                <a
                  href="/settings"
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Settings className="h-2.5 w-2.5" />
                  Settings
                </a>
              </nav>
            </div>
          </div>
        </aside>

        <main className="container mx-auto h-full overflow-auto px-4 py-6 md:ml-64">
          {/* Console segment stubs (app/{alerts,analytics,settings}/page.tsx) are
              empty <div/> by design; the real panel lives in the matching @-slot,
              which is rendered here so the console pages actually show content.
              Only the slot for the active route is non-null. */}
          <Suspense fallback={<Loading />}>
            {children}
            {dashboard}
            {analytics}
            {alerts}
            {settings}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
