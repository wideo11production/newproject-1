/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // Next.js inhe transpile nahi karta by default - isliye ye list ZAROORI
  // hai, bina iske @wideo11/ui ke .tsx files par build fail hota hai.
  //   @wideo11/ui     - component library (raw .tsx, next/server imports)
  //   @wideo11/config - config loader (raw .ts)
  //   @wideo11/utils  - utility functions (raw .ts)
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' }
    ]
  }
};

export default nextConfig