/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output - minimal server bundle for Docker runner stage
  output: 'standalone',

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
