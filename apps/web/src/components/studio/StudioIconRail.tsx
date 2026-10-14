'use client';

/**
 * STUDIO ICON RAIL - the thin vertical rail on the far left.
 *
 * =============================================================================
 * WHY IT SITS OUTSIDE THE MAIN CONTAINER
 * =============================================================================
 *
 * It is a wayfinding rail, not part of the workspace. Putting it inside the
 * content container would make it look like a per-tool control and would push
 * the workspace sideways whenever the workspace's own padding changed.
 *
 * Outside the container it stays in one place across the upload page, the channel
 * page and everything else, which is the only reason a rail is worth having.
 *
 * =============================================================================
 * WHY IT DOES NOT SCROLL
 * =============================================================================
 *
 * `position: fixed`. A rail that scrolls away is a rail that only works at the
 * top of the page, and the whole point of it is being reachable while a video
 * plays further down.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Video, Settings, Layers } from 'lucide-react';

import {
  productAccent,
  productAccentBg,
  productAccentShadowStrong,
  productAccentSoftBg,
  productPanel,
  productPanelHover,
  productTextMuted,
} from '@wideo11/ui/design-system';

export interface StudioIconRailProps {
  /** Where the brand tile links to. */
  homeHref?: string;
  /** Where the media tile links to. */
  mediaHref?: string;
  /** Where the settings tile links to. */
  settingsHref?: string;
}

export function StudioIconRail({
  homeHref = '/dashboard',
  mediaHref = '/videos',
  settingsHref = '/dashboard/settings',
}: StudioIconRailProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Workspace rail"
      className={`fixed left-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 rounded-2xl ${productPanel}/80 p-1.5 shadow-xl shadow-black/30 backdrop-blur lg:flex`}
    >
      {/* The brand tile is the rail's anchor: it is the only thing on it that
          names the product, and everything else is a destination. */}
      <Link
        href={homeHref}
        aria-label="Wideo11 home"
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${productAccentBg} text-white shadow-md ${productAccentShadowStrong} transition-transform hover:scale-105`}
      >
        <Layers className="h-4 w-4" aria-hidden="true" />
      </Link>

      <RailLink href={mediaHref} label="Media" active={pathname.startsWith(mediaHref)}>
        <Video className="h-4 w-4" aria-hidden="true" />
      </RailLink>

      <RailLink href={settingsHref} label="Settings" active={pathname.startsWith(settingsHref)}>
        <Settings className="h-4 w-4" aria-hidden="true" />
      </RailLink>
    </nav>
  );
}

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
        active
          ? `${productAccentSoftBg} ${productAccent}`
          : `${productTextMuted} ${productPanelHover} hover:text-white`
      }`}
    >
      {children}
    </Link>
  );
}
