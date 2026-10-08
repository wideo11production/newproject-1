'use client';

// The dark/light toggle, and the provider that makes it work.
//
// -----------------------------------------------------------------------------
// WHY THIS IS HERE AND NOT IN apps/web
// -----------------------------------------------------------------------------
//
// `apps/web` has a working `ThemeToggle` at `src/app/components/header.tsx:33`.
// It is 15 lines, it is the only theme toggle in the product, and it is unreachable
// from the other seven apps.
//
// That is the same shape as every other copy-paste finding in this repository: one
// working implementation, seven apps unable to reach it, and a bug fixed in one
// place that stays broken in six. A fix that lives in one app is not a fix.
//
// So it lives in `@wideo11/ui`, where all eight apps already import
// `enterpriseTheme` from. One implementation, eight consumers, and a new app gets
// a working theme by importing two things rather than by copying 15 lines and
// hoping.
//
// -----------------------------------------------------------------------------
// WHY NOT `next-themes`
// ------------------------------------------------------------------------------
//
// `next-themes` is in `apps/web`'s dependencies and genuinely works there. It is
// NOT used here, for two reasons that are about this codebase rather than about
// the library:
//
//  1. It is a `node_modules` dependency the other seven apps would each have to
//     add. `packages/ui` cannot depend on it and have the app resolve it - the
//     dependency has to live in each consuming app's `package.json`, so "share the
//     implementation" would still mean eight edits.
//
//  2. The interesting part is twenty lines of script and about fifteen lines of
//     state. Depending on a package for that, in a product that has been trying to
//     have zero third-party runtime costs, is the wrong trade.
//
// What is reimplemented is deliberately only the part in use: a class on
// `<html>`, one localStorage key, and a pre-paint script. Not SSR-aware mode
// resolution, not multi-tab sync, not no-JS fallback.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { THEME_STORAGE_KEY } from './theme';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Read the theme the pre-paint script already applied.
 *
 * Reads the CLASS rather than localStorage, and that ordering is the whole point:
 * the script in `<head>` has already set `documentElement.classList`, so the
 * correct value is on the element. Reading storage again would be a second source
 * of truth that could disagree with the DOM - and if it did, React would render
 * light while the page behind it is dark, which is a visible flash on hydration.
 */
function readAppliedTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

/**
 * Provide theme state to a subtree.
 *
 * State is seeded from the DOM (see `readAppliedTheme`) rather than initialised to
 * a constant, because the server has no idea what the user's theme is and the
 * pre-paint script has already resolved it. Initialising to `'dark'` would render
 * one frame of dark for a light-theme user before correcting - a flash on every
 * navigation, which is the exact problem the pre-paint script exists to prevent.
 *
 * `suppressHydrationWarning` on `<html>` is still required. The server rendered
 * `class="dark"`; the client may end up with `class="light"`. React is right to
 * complain and the warning is noise, not a bug.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  // Adopt whatever the pre-paint script decided, once, after mount.
  useEffect(() => {
    setThemeState(readAppliedTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);

    const root = document.documentElement;
    root.classList.remove('light');
    if (next === 'light') root.classList.add('light');

    // `colorScheme` is what themes the browser's own furniture: scrollbars, select
    // dropdowns, autofill. CSS variables do not reach any of it, so a page without
    // this line gets a dark palette with a white scrollbar and looks unfinished.
    root.style.colorScheme = next;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private browsing, some corporate policies).
      // The theme still applies for this page view; it just will not be
      // remembered. Failing to persist a preference is not worth interrupting
      // anyone over.
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(readAppliedTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>;
}

/**
 * Read the theme.
 *
 * Throws outside a provider rather than returning a default. A silent default here
 * would mean a component renders with `theme: 'dark'` in an app that has no
 * provider, the toggle appears to do nothing, and the cause is invisible. An
 * explicit error names the missing provider at the point of the mistake.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside a <ThemeProvider>.');
  }
  return ctx;
}

/**
 * The toggle button.
 *
 * Both icons are rendered and one is hidden with CSS, rather than swapping the
 * icon in JS. That is deliberate: the choice of which icon shows must follow the
 * CLASS on `<html>`, not React state. If it followed state, the icon would be one
 * render behind the page during hydration and would flash.
 *
 * `aria-label` says which mode you would GET, not which one is active - "Switch to
 * light theme" on a dark page. The other convention ("Dark theme", naming the
 * current state) makes the button's accessible name describe the page rather than
 * the action.
 *
 * `suppressHydrationWarning` is required for the same reason the root needs it: the
 * server cannot know the theme.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-md border-0 bg-[#1a1a1a] text-gray-400 transition-all duration-150 hover:bg-[#2a2a2a] hover:text-[#ff6500] ' +
        'focus:outline-none focus:ring-2 focus:ring-[#ff6500] ' +
        className
      }
    >
      {/* Sun: shown in dark mode (i.e. "go light"). Hidden via the parent class. */}
      <svg
        className="light:hidden h-2.5 w-2.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>

      {/* Moon: shown in light mode (i.e. "go dark"). */}
      <svg
        className="hidden light:block h-2.5 w-2.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    </button>
  );
}
