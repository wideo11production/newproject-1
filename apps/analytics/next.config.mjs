/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' }
    ]
  },
  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // Next.js inhe transpile nahi karta by default - isliye ye list ZAROORI
  // hai. @wideo11/config aur @wideo11/utils naye jod ke gaye hain taaki
  // sabhi apps ek hi transpile boundary follow karein.
  //
  // `wideo11-charts` (ECharts wrappers) raw TypeScript source ship karta hai -
  // uska `main` field `src/index.ts` hai, koi build step nahi. Next.js
  // node_modules ke code ko by default transpile NAHI karta, isliye bina is
  // setting ke build fail hota hai:
  //   Module not found: Can't resolve 'wideo11-charts'
  //
  // (Ye error misleading hai - package maujood hai, node_modules me linked
  // bhi hai. Asli wajah ye hai ki Next use apne compiler se chal nahi sakta,
  // isliye module resolve hi nahi hota.)
  //
  // `@wideo11/ui` bhi list me hai - wo bhi raw TSX ship karta hai.
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils', 'wideo11-charts'],
};

export default nextConfig