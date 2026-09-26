/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output - minimal server bundle for Docker runner stage
  output: 'standalone',
  // Env var jo frontend use karta hai currency service hit karne ke liye
  env: {
    NEXT_PUBLIC_CURRENCY_API: process.env.NEXT_PUBLIC_CURRENCY_API ?? 'http://localhost:8086',
  },
  // Air-gapped font: koi next/font/google nahi, system fonts use hote hain
};

export default nextConfig;
