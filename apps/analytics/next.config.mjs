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
  // `wideo11-charts` ships raw TypeScript (its `main` is `src/index.tsx`), so
  // Next cannot consume it without being told to transpile it. Without this,
  // the build fails with `Module not found: Can't resolve 'wideo11-charts'` -
  // an error that points at resolution rather than at the missing transpile
  // step, which is what makes it slow to diagnose.
  //
  // `@wideo11/ui` was already here and also ships raw TSX.
  transpilePackages: ['@wideo11/ui', 'wideo11-charts'],
};

export default nextConfig