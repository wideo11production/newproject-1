/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output - minimal server bundle for Docker runner stage
  output: 'standalone',
};

export default nextConfig;
