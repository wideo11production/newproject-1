/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Custom distDir: monitor ka build output .next-monitor me jata hai taaki
  // monorepo ke shared .next folder se collision na ho
  distDir: '.next-monitor',
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',

  // ---- `transpilePackages` ZAROORI HAI ----
  //
  // Hinglish: Ye shared packages RAW TypeScript/TSX ship karte hain.
  // `wideo11-charts` (ECharts wrappers) raw TypeScript source ship karta hai -
  // uska `main` field `src/index.ts` hai, koi build step nahi. Next.js
  // node_modules ke code ko by default transpile NAHI karta, isliye bina is
  // setting ke build fail hota hai:
  //   Module not found: Can't resolve 'wideo11-charts'
  //
  // (Ye error misleading hai - package maujood hai, node_modules me linked
  // bhi hai. Asli wajah ye hai ki Next use apne compiler se chal nahi sakta,
  // isliye module resolve hi nahi hota.)
  //
  // Doosra option hai: `packages/charts` me proper `tsc` build karke
  // `dist/` publish karna. Ye zyada "sahi" hai, par ek shared package ke
  // liye extra build step + artifacts chahiye - jabki source-transpile
  // monorepo me standard practice hai aur dev experience behtar deta hai
  // (package edit karte hi turant reflect, rebuild ka wait nahi).
  //
  // NOTE: `@wideo11/ui` bhi list me hai - wo bhi raw TSX ship karta hai. Wo
  // pehle bhi import hota tha aur chalta tha, ye list usko bhi cover karti
  // hai taaki wo pehle se kabhi fail na ho.
  //
  // @wideo11/config aur @wideo11/utils bhi naye se add kiye gaye hain taaki
  // sabhi apps ek hi transpile boundary follow karein.
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils', 'wideo11-charts'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.unsplash.com' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' }
    ]
  },
  // NOTE: Is file se pehle ek PageFilterPlugin webpack hack tha jo duplicate app
  // directory (apps/monitor/app) ke leaked pages ko manifest se chhupa raha tha.
  // Wo duplicate directory ab .stale-backup/monitor-app-duplicate me move kar diya
  // gaya hai, aur saare routes ab sirf src/app se aate hain. Plugin ab zaroorat nahi.
  // Wo plugin allowedPages sirf /page, /layout, /_not-found rakhta tha jo asli
  // @metrics aur @telemetry pages ko manifest se delete kar deta tha - yaani
  // wo asal build ko hi corrupt kar raha tha. Isliye use hata diya gaya hai.
};

export default nextConfig;
