// PWA manifest — Wideo11 Analytics.
//
// WHY THIS EXISTS
// ---------------
// The app had no icon of any kind, so the tab strip showed Chrome's default blank
// glyph.
//
// `app/icon.svg` emits `<link rel="icon">` and is animated via SMIL inside the SVG.
// See that file's header for browser support, including that Safari ignores SMIL in
// a favicon and gets the static composition.
//
// The PNGs are copied from `apps/web` rather than regenerated: Chrome's install
// criteria require 192x192 and 512x512 PNG, an SVG will not satisfy them, and
// reusing the rasterised brand marks adds no image dependency.
//
// The tab icon is the animated SVG; the PNGs are for install and bookmarks.

import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wideo11 Analytics',
    short_name: 'Analytics',
    description: 'Platform analytics — users, retention, clickstream and revenue.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111217',
    theme_color: '#111217',
    orientation: 'any',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
  };
}
