/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
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