/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  
  images: {
    // FIX: Saare allowed domains ko ek hi arrays layout block mein cleanly merge kar diya hai
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      // FIX: Placeholder tracking host add kiya aur format clean kiya bina extra strings ke
      {
        protocol: 'https',
        hostname: 'via.placeholder.com',
        port: '',
        pathname: '/**',
      }
    ]
  },
  
  transpilePackages: ['@wideo11/ui'],
  
  // Hamaara main Webpack symlinks boundary mechanism safe and untouched hai
  webpack: (config) => {
    config.resolve.symlinks = false;
    return config;
  }
};

export default nextConfig;
