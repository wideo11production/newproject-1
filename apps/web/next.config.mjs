/** @type {import('next').NextConfig} */

// ============================================================================
// SECURITY HEADERS  -  Phase A / gap #2 (frontend half)
// ============================================================================
//
// Backend (auth-service) par security headers lag gaye hain, par ek SPA/SSR
// frontend ke liye wo KAAFI NAHI. Reason: backend sirf JSON API serve karta
// hai, jabki ye page HTML render karta hai. XSS ka asli risk yahan hai - ek
// injected `<script>` tag browser me chalega, aur ye us page ke origin par
// session cookie bhi padh sakta hai.
//
// Isliye frontend ke liye alag se headers chahiye, aur wo CHROME/BROWSER ko
// dete hain - backend se koi farak nahi padta is response pe.
//
// ---- WHAT EACH HEADER BLOCKS ----
//  X-Content-Type-Options  MIME sniffing off (uploaded file HTML ban kar
//                          browser me chal sakti thi)
//  X-Frame-Options/CSP     clickjacking
//  Referrer-Policy         token/password-reset URL dusri site pe leak na ho
//  Permissions-Policy      camera/mic/geo off (app inka use nahi karti)
//  HSTS                    sslstrip attack (HTTPS pe force)
//  CSP                     script injection - asli XSS defence
//
// ---- WHY CSP IS ENV-GATED ----
// Ek strict CSP bina sahi nonces ke Next.js ko CHURA deta hai: Next apne
// hydration scripts inline `<script>` tags me embed karta hai, aur bina
// 'unsafe-inline' (ya nonce) ke wo block ho jate hain -> app white screen.
//
// Isliye:
//   - dev me CSP relaxed hai (HMR ko 'unsafe-eval' chahiye)
//   - prod me 'unsafe-eval' hata diya gaya hai
//
// ---- KNOWN LIMITATION, HONESTLY ----
// `script-src 'unsafe-inline'` se CSP ek injected inline <script> ko rokta
// NAHI hai. Ye real limitation hai. Iske liye proper fix nonce-based CSP hai
// (middleware se `x-nonce` header padho - Next apne scripts pe nonces laga
// deta hai). Wo agla step hai; jab tak wo nahi hai, ye headers XSS ke
// kai vectors band karte hain par sab nahi.
//
// Ye "done" claim karna galat hota jab tak nonce-based CSP na ho. Isliye
// comment me likha hai.
//
// Hinglish: backend headers API ke liye, ye HTML page ke liye

/** Comma-separated env var -> trimmed array. */
const list = (value, fallback) => {
  if (!value) return fallback;
  const items = String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
};

const isDev = process.env.NODE_ENV !== 'production';

// ---- Origins the app actually talks to ----
// Ye CSP me allow hone CHAHIYE, warna app apna hi API/MinIO call nahi kar payega.
const API_ORIGINS = list(process.env.NEXT_PUBLIC_AUTH_API, ['http://localhost:8085']);
const STORAGE_ORIGINS = list(process.env.NEXT_PUBLIC_MINIO_PUBLIC_HOST, [
  'http://localhost:9000',
]);

/**
 * Content-Security-Policy build karta hai.
 *
 * Directive by directive:
 *  default-src 'none'      koi resource allow nahi, har type explicitly allow
 *  script-src              'self' + Next ke inline scripts ke liye 'unsafe-inline'
 *                          (dev me HMR ke liye 'unsafe-eval' bhi)
 *  style-src               'unsafe-inline' chahiye - Tailwind + emotion runtime
 *                          style tags inject karte hain
 *  img-src                 'self' + data: (inline avatar placeholder) +
 *                          storage (avatars MinIO se aate hain) +
 *                          unsplash/github (placeholder avatars)
 *  connect-src             'self' + API + storage + (dev me ws: HMR websocket)
 *  frame-ancestors 'none'  clickjacking
 *  object-src 'none'       <object>/<embed> se plugin content block
 *  base-uri 'self'         <base> tag injection se relative-URL hijack block
 *  form-action 'self'      form ka action dusre domain pe nahi ja sakta
 *  upgrade-insecure-requests  prod me http sub-resources ko https pe force
 */
function buildCSP() {
  const directives = {
    'default-src': ["'none'"],
    'script-src': [
      "'self'",
      // Next.js apne hydration/bootstrap scripts inline embed karta hai.
      // Nonce-based CSP migrate karne tak ye zaroori hai.
      "'unsafe-inline'",
      // DEV ONLY: react-refresh (HMR) eval use karta hai. Production me
      // 'unsafe-eval' RCE surface hai, isliye wahan nahi hai.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    // Tailwind ke saath kuch libraries runtime <style> inject karte hain.
    'style-src': [
      "'self'",
      "'unsafe-inline'",
      // DEV ONLY: kuch CSS-in-JS helpers eval use karte hain.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...STORAGE_ORIGINS],
    'connect-src': [
      "'self'",
      ...API_ORIGINS,
      ...STORAGE_ORIGINS,
      // Dev me Next HMR ke liye WebSocket use karta hai.
      ...(isDev ? ['ws:', 'wss:'] : []),
    ],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", ...STORAGE_ORIGINS],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    // ---- The actual security wins ----
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    ...(isDev ? {} : { 'upgrade-insecure-requests': [] }),
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(' ')}` : key))
    .join('; ');
}

/**
 * HSTS - sirf production me, aur sirf tab jab value set ho.
 *
 * Local dev plain HTTP (http://localhost:3000) par chalta hai. HSTS wahan
 * bhejne se browser ka HSTS cache atak jaata hai aur user ko hack-proof
 * karne ke liye `http://localhost:3000` type karke "thisisunsafe.com" visit
 * karna padta hai. Ye ek classic, khud-budha hua dev break hai.
 *
 * ---- VAR KA NAAM: `SECURITY_`, NA KI `NEXT_PUBLIC_` ----
 *
 * Pehle ye `process.env.NEXT_PUBLIC_HSTS_MAX_AGE` padhta tha, jabki compose
 * aur `.env` dono `SECURITY_HSTS_MAX_AGE` set karte hain. Do alag naam, do alag
 * jagah, aur beech me koi connection nahi - matlab header kabhi on nahi hota tha.
 * `.env` me `SECURITY_HSTS_MAX_AGE=31536000` daal kar production me HSTS
 * chalu karne ki koshish bhi chup-chaap nahi karti.
 *
 * `NEXT_PUBLIC_` isliye bhi galat choice tha: wo prefix browser bundle ke liye
 * hai. HSTS ek RESPONSE HEADER hai jo server bhejta hai - iska browser code me
 * koi matlab nahi, aur use expose karna usse zyada expose karta hai. Naam me
 * ye baat dikhti hai, isliye naam theek rakhna hai.
 *
 * `includeSubDomains` alag flag hai, kyunki har deployment ko wo chahiye hi
 * nahi - kuch shops subdomain ke bina khulte hain aur force karne se unka
 * MX/bare-domain redirect toot jata hai.
 */
const HSTS_MAX_AGE = process.env.SECURITY_HSTS_MAX_AGE;
const HSTS_INCLUDE_SUBDOMAINS = process.env.SECURITY_HSTS_INCLUDE_SUBDOMAINS;
const hstsMaxAge = Number(HSTS_MAX_AGE);
const hstsValue =
  !isDev && Number.isFinite(hstsMaxAge) && hstsMaxAge > 0
    ? [
        `max-age=${hstsMaxAge}`,
        HSTS_INCLUDE_SUBDOMAINS === 'true' ? 'includeSubDomains' : null,
      ]
        .filter(Boolean)
        .join('; ')
    : null;

// next.config.mjs header() return shape: [{ source, headers: [{key, value}] }]
const securityHeaders = [
  // ---- 1. MIME sniffing off ----
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  // ---- 2. Clickjacking off (CSP + legacy dono) ----
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: buildCSP() },

  // ---- 3. Referrer me full path leak na ho ----
  // strict-origin-when-cross-origin: same-origin pe full URL (SPA routing
  // ke liye chahiye), cross-origin pe sirf origin. Isse password-reset
  // token jaisa path dusri site ko nahi jata.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  // ---- 4. Unused powerful features band ----
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  },

  // ---- 5. Cross-origin isolation ----
  // COOP: window.opener cross-origin reference nahi kar sakta (tabnabbing).
  // CORP: `same-origin` default hai - isse avatar images jo MinIO se aati
  // hain (cross-origin) BLOCK ho jayengi, isliye `same-site` set kiya hai.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },

  // ---- 6. HSTS (prod + explicitly configured only) ----
  ...(hstsValue ? [{ key: 'Strict-Transport-Security', value: hstsValue }] : []),

  // ---- 7. Misc leak reduction ----
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Standalone output: minimal server bundle for Docker runner stage
  // Standalone output se Docker runner stage ko minimal server bundle milta hai
  output: 'standalone',

  // ---- Security headers ----
  async headers() {
    return [
      {
        // NOTE: `/:path*` se static assets bhi cover hote hain. Sirf pages
        // pe lagane se `_next/static` files pe headers missing rehte, jo
        // browser cache behavior ko half-inconsistent banata hai.
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

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
