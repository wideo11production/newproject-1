/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/editor-core', '@wideo11/video-player'],
  experimental: {
    optimizePackageImports: ['@wideo11/ui'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;