/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output - minimal server bundle for Docker runner stage
  output: 'standalone',

  // ---- MONOREPO TRANSPILE BOUNDARY ----
  //
  // Hinglish: Ye teen shared packages RAW TypeScript/TSX ship karte hain
  // (unke `main` field `src/index.ts` ya `src/index.tsx` point karte hain,
  // koi build step nahi). Next.js node_modules ka code by default transpile
  // NAHI karta - isliye bina transpilePackages ke ye packages ke .tsx files
  // directly Webpack ke saath aate hain jisme TypeScript syntax handle nahi
  // hoti, aur build fail hota hai:
  //
  //   ModuleParseError: Unexpected token 'export'
  //   Cannot find module 'next/server'
  //
  // @wideo11/ui       - contains next/server imports (audit-handler.ts,
  //                      auth-gate.ts, health-handler.ts, presence-handler.ts)
  //                      and raw .tsx component source (barrel exports)
  // @wideo11/config   - raw .ts config loader; used by admin/monitor layout
  // @wideo11/utils    - raw .ts utility functions (cn, formatBytes, etc.)
  //
  // Ye list ensure karti hai ki Webpack in packages ko transpile kare SAASTE
  // source se, jisse TypeScript syntax aur ESM exports sahi se JS me convert
  // hote hain. Har package ka `main`/`types` field src/ point karta hai (no dist/
  // build), isliye ye ZAROORI hai.
  //
  // NOTE: Package name @wideo11/utils (pehle wideo11-utils tha) - rename karke
  // transpilePackages se bhi match kar gaya.
  transpilePackages: ['@wideo11/ui', '@wideo11/config', '@wideo11/utils'],

  // Security headers including CSP for superadmin app
  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';

    // Origins the superadmin app actually talks to
    const API_ORIGINS = ['http://localhost:8085', 'http://localhost:8091'];
    const STORAGE_ORIGINS = ['http://localhost:9000'];

    // Build CSP directives
    const cspDirectives = {
      'default-src': ["'none'"],
      'script-src': [
        "'self'",
        "'unsafe-inline'",
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
      'style-src': [
        "'self'",
        "'unsafe-inline'",
        ...(isDev ? ["'unsafe-eval'"] : []),
      ],
      'img-src': ["'self'", 'data:', 'blob:', 'https:', ...STORAGE_ORIGINS],
      'connect-src': [
        "'self'",
        ...API_ORIGINS,
        ...STORAGE_ORIGINS,
        ...(isDev ? ['ws:', 'wss:'] : []),
      ],
      'font-src': ["'self'", 'data:'],
      'media-src': ["'self'", ...STORAGE_ORIGINS],
      'worker-src': ["'self'", 'blob:'],
      'manifest-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
    };

    const csp = Object.entries(cspDirectives)
      .map(([key, values]) => (values.length ? `${key} ${values.join(' ')}` : key))
      .join('; ');

    const securityHeaders = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: csp },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      {
        key: 'Permissions-Policy',
        value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
      },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
      { key: 'X-DNS-Prefetch-Control', value: 'off' },
      { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    ];

    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
