/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' }
    ]
  },
  transpilePackages: ['@wideo11/ui'],
}

module.exports = nextConfig