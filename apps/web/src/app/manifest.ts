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
    // ---- ICONS: PNG zaroori hai, SVG kaafi nahi ----
    //
    // Chrome ka install criteria specifically 192x192 aur 512x512 **PNG**
    // icons maangta hai. Sirf SVG dene se browser "Install app" prompt
    // HI NAHI DIKHAYEGA, chahe manifest aur rest sab perfect ho.
    //
    // Ye PNGs `public/brand.svg` se generate hue hain (headless Edge se
    // rasterize karke) - koi naya image dependency add nahi hua.
    //
    // `purpose: 'maskable'` wale alag se hain: Android inhe circle/squircle
    // me crop kar sakta hai, isliye unme glyph ke around extra padding hoti
    // hai jisse crop hone par bhi logo poori tarah dikhe.
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      // iOS home-screen icon (manifest ke bajaye apple-touch-icon link)
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
    ],
    // PWA shortcuts - mobile long-press menu me direct access
    shortcuts: [
      { name: 'Dashboard', url: '/dashboard' },
      { name: 'Upload', url: '/upload' },
      { name: 'Channels', url: '/channels' },
    ],
  };
}
