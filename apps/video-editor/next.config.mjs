/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // Next.js inhe transpile nahi karta by default - isliye ye list ZAROORI
  // hai, bina iske 'Module not found' ya 'Unexpected token export' errors
  // aate hain. @wideo11/config aur @wideo11/utils naye jod ke gaye hain
  // (pehle sirf @wideo11/ui etc. the).
  transpilePackages: [
    '@wideo11/ui',
    '@wideo11/config',
    '@wideo11/utils',
    '@wideo11/editor-core',
    '@wideo11/video-player',
    '@wideo11/charts',
    '@wideo11/dnd-dashboard',
    '@wideo11/forms',
    '@wideo11/i18n',
  ],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;