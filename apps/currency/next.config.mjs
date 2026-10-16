/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output - minimal server bundle for Docker runner stage
  output: 'standalone',
  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // Next.js inhe transpile nahi karta by default - isliye ye list ZAROORI
  // hai, bina iske @wideo11/ui ke .tsx files par build fail hota hai.
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils'],
  // Env var jo frontend use karta hai currency service hit karne ke liye
  env: {
    NEXT_PUBLIC_CURRENCY_API: process.env.NEXT_PUBLIC_CURRENCY_API ?? 'http://localhost:8086',
  },
  // Air-gapped font: koi next/font/google nahi, system fonts use hote hain
};

export default nextConfig;
