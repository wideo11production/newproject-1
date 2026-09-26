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
