/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  transpilePackages: [
    '@wideo11/ui',
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