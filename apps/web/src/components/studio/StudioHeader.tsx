'use client';

/**
 * STUDIO HEADER - the minimalist top navigation.
 *
 * =============================================================================
 * WHAT IT CARRIES
 * =============================================================================
 *
 * Logo, four links (Home, Uploads, Resources, Player) and the profile. That is
 * the whole brief, and it is deliberately that small: this header sits above a
 * 50/50 workspace whose content is the point.
 *
 * =============================================================================
 * WHY IT IS NOT BORDERED
 * =============================================================================
 *
 * A border under it would be the one explicit line in a layout built on contrast
 * alone. The separation comes from the header being a slightly lighter surface
 * than the page behind it - which is also why it survives the deep charcoal
 * background without disappearing into it.
 */

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Upload, BookOpen, PlayCircle, ChevronDown } from 'lucide-react';

interface StudioHeaderProps {
  /** Signed-in user's display name, for the profile chip. */
  displayName?: string;
  /** Signed-in user's avatar, when there is one. */
  avatarUrl?: string | null;
}

const NAV = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/dashboard/upload', label: 'Uploads', icon: Upload },
  { href: '/resources', label: 'Resources', icon: BookOpen },
  { href: '/videos', label: 'Player', icon: PlayCircle },
];

export function StudioHeader({ displayName = 'Creator', avatarUrl }: StudioHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-[#0d0f11]/95 backdrop-blur supports-[backdrop-filter]:bg-[#0d0f11]/80">
      <nav className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-2.5 sm:px-6" aria-label="Studio">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2" aria-label="Wideo11 home">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#ff6500] shadow-md shadow-[#ff6500]/25">
            <PlayCircle className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">Wideo11</span>
        </Link>

        {/* Links */}
        <ul className="ml-2 hidden items-center gap-0.5 md:flex">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#16181d] text-[#ff6500]'
                      : 'text-[#8b949e] hover:bg-[#16181d] hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex-1" />

        {/* Profile */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 rounded-full bg-[#16181d] py-1 pl-1 pr-2.5 transition-colors hover:bg-[#1f2227]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#2c3235] text-[10px] font-semibold text-white">
                {displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="hidden max-w-[10ch] truncate text-xs font-medium text-white sm:inline">
              {displayName}
            </span>
            <ChevronDown className="h-3 w-3 text-[#8b949e]" aria-hidden="true" />
          </button>

          {menuOpen ? (
            <>
              {/* click-away: without it a menu stays open until the next click on
                  the button, which reads as a broken menu */}
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1.5 w-44 overflow-hidden rounded-xl bg-[#16181d] py-1 shadow-xl shadow-black/40"
              >
                <Link
                  href="/dashboard"
                  role="menuitem"
                  className="block px-3 py-2 text-xs text-white transition-colors hover:bg-[#1f2227]"
                  onClick={() => setMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link
                  href="/dashboard/settings"
                  role="menuitem"
                  className="block px-3 py-2 text-xs text-white transition-colors hover:bg-[#1f2227]"
                  onClick={() => setMenuOpen(false)}
                >
                  Settings
                </Link>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void (async () => {
                      try {
                        await fetch('/api/auth/logout', { method: 'POST' });
                      } finally {
                        // Sync as well as the router: a push alone leaves the
                        // shell rendering signed-in chrome for one frame.
                        router.replace('/auth/login');
                        router.refresh();
                      }
                    })();
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-[#8b949e] transition-colors hover:bg-[#1f2227] hover:text-white"
                >
                  Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
