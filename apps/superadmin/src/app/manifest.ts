// PWA manifest — Wideo11 Superadmin.
//
// WHY THIS EXISTS
// ---------------
// Before this, the app had NO icon of any kind: no `favicon.ico`, no `icon.svg`,
// no manifest. The tab strip showed Chrome's default blank-page glyph, which is
// indistinguishable from every other untitled tab - and this app is the one you
// least want to open by accident.
//
// Next.js App Router conventions, all three of which matter:
//
//   `app/icon.svg`   -> emits `<link rel="icon">` automatically. Animated, via
//                       SMIL inside the SVG. See that file's header for browser
//                       support, including the fact that Safari ignores SMIL in a
//                       favicon and gets the static composition.
//   `app/manifest.ts`-> this file. Drives the install prompt and the home-screen
//                       icon on mobile.
//   `public/*.png`   -> the installable sizes.
//
// WHY THE PNGs ARE COPIED RATHER THAN REGENERATED
// ------------------------------------------------
// Chrome's install criteria require 192x192 and 512x512 **PNG**. An SVG does not
// satisfy them - supply only SVG and the "Install app" prompt never appears, no
// matter how correct the manifest is. These are the same rasterised brand marks
// `apps/web` already ships, so no image dependency is added and the mark stays
// identical across the product.
//
// The tab icon is the animated SVG; these PNGs are for install and bookmarks. The
// two are deliberately different files serving different browsers, not two
// versions of one asset.
//
// `purpose: 'maskable'` entries are separate because Android may crop them to a
// circle or squircle; they carry extra padding around the glyph so the mark
// survives the crop.

import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wideo11 Superadmin',
    short_name: 'Superadmin',
    description: 'Master control panel — security, click ledger and user intelligence.',
    // `/` is the whole app. There is no second page to start from, and `start_url`
    // pointing at a route that does not exist is the classic way an install prompt
    // leads to a 404.
    start_url: '/',
    display: 'standalone',
    // Grafana enterprise panel colour, matching the app background, so the browser
    // chrome blends rather than forming a bright band above a dark page.
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
