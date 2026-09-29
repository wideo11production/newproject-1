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
// NOTE: parallel route slots (@dashboard / @analytics / @alerts) root layout
// me destructure to hote hain par JSX me use NAHI hote - wo pehle se dead
// thay. Isliye unhe yahan nahi laaya gaya, aur koi routing structure nahi badla.
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
} from '@/app/components/header';
import { BarChart3, Activity, Bell, Settings } from 'lucide-react';

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

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Public / marketing / auth page: page apna layout khud handle karta hai.
  // Koi header ya sidebar nahi - warna dono ek dusre ko overlap karte hain.
  if (!isConsoleRoute(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950">
      <header className="border-b border-gray-800 bg-gray-900/50">
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
        <aside className="absolute left-0 top-0 z-10 hidden h-full w-64 border-r border-gray-800 bg-gray-950/90 backdrop-blur-sm md:block">
          <div className="p-4">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Navigation
              </h3>
              <nav className="space-y-1">
                <a
                  href="/dashboard"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <BarChart3 className="h-4 w-4" />
                  Dashboard
                </a>
                <a
                  href="/analytics"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Activity className="h-4 w-4" />
                  Analytics
                </a>
                <a
                  href="/alerts"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Bell className="h-4 w-4" />
                  Alerts
                </a>
                <a
                  href="/settings"
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-ink"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </a>
              </nav>
            </div>
          </div>
        </aside>

        <main className="container mx-auto h-full overflow-auto px-4 py-6 md:ml-64">
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}
