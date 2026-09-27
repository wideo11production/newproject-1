// PWA web app manifest
//
// KYUN YE ZAROORI HAI:
// Pehle app me koi icon file hi nahi thi - na favicon, na apple-icon, na manifest.
// Isliye browser tab bar me default "dead" globe icon dikhta tha.
//
// Next.js App Router:
//   - `app/icon.svg`      -> automatically <link rel="icon"> bana deta hai
//   - `app/apple-icon.svg`-> iOS home screen icon
//   - `app/manifest.ts`   -> PWA manifest (Chrome/Android install, shortcuts)
//
// Is file se tab bar, bookmarks, mobile home screen aur PWA install sab pe
// BRANDED "W" icon dikhega - live aur high-fidelity.
//
// Theme colours Grafana enterprise palette se match karte hain (design tokens
// ke saath consistent), taaki browser chrome bhi app ke saath blend ho.
//
// Hinglish: PWA manifest - tab/bookmark/mobile sab pe branded icon
import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Wideo11',
    short_name: 'Wideo11',
    description: 'Create, publish and earn on your own video platform.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111217', // grafana.bg - app background se match
    theme_color: '#111217', // browser chrome ka colour
    orientation: 'any',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/apple-icon.svg',
        sizes: '180x180',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
    // PWA shortcuts - mobile long-press menu me direct access
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard' },
      { name: 'Upload', url: '/upload' },
      { name: 'Channels', url: '/channels' },
    ],
  };
}
