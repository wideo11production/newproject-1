/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',
  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // @wideo11/ui - component library (raw .tsx, next/server imports)
  // @wideo11/config - config loader (raw .ts)
  // @wideo11/utils - utility functions (raw .ts)
  //
  // `experimental.optimizePackageImports` YAHAN SE HATA DIYA GAYA.
  // Ye flag @wideo11/ui ke barrel imports ko REWRITE karta hai. Jab maine
  // @wideo11/ui me naya export (activity-tracker) add kiya, to is flag ki wajah se
  // admin ka page.tsx build output se GAYAB ho gaya tha - app-path-routes-manifest
  // me sirf /api/audit/route bacha, aur "/" par 404 aa raha tha.
  //
  // Ye experimental flag hai - production me risky hota hai. Hatakar problem
  // permanently khatam ho gayi, aur humein us feature ki zarurat bhi nahi thi.
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils'],
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