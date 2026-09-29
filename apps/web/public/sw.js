/* eslint-disable no-restricted-globals */
/**
 * ============================================================================
 * Wideo11 SERVICE WORKER
 * ============================================================================
 *
 * YE PWA INSTALL KE LIYE ZAROORI HAI.
 * Chrome ka "Install app" prompt sirf tab aata hai jab:
 *   1. Valid manifest ho (name, icons 192+512 PNG, start_url, display)  ✅ done
 *   2. Service worker ho jisme FETCH HANDLER ho                         <-- ye file
 *   3. HTTPS ho (localhost automatically exempt hai, dev ke liye theek hai)
 *
 * Bina service worker ke manifest kitna bhi perfect ho, Chrome INSTALL
 * PROMPT HI NAHI DIKHAYEGA. Ye file usi ek requirement ko poora karti hai.
 *
 * ---------------------------------------------------------------------------
 * CACHING STRATEGY (deliberate, aur reasons ke saath)
 * ---------------------------------------------------------------------------
 * Ye BAHUT carefully choose kiya gaya hai, kyunki galat caching strategy
 * production me disaster hoti hai - purana JS bundle serve ho jaata hai aur
 * users ko bugs milte hain jo "fix ho chuka hai" lagte hain.
 *
 *   1. NAVIGATIONS (page loads)
 *      -> NETWORK FIRST, cache fallback.
 *      Pehle hamesha network try karo (fresh HTML mile). Agar offline ho ya
 *      server down ho, tab cached page dikhao.
 *      REASON: HTML ko cache-first karna stale pages deta hai. Hum freshness
 *      ko prefer karte hain - offline hone par purana page dikhna acceptable
 *      hai, par online hone par purana page dikhna BUG hai.
 *
 *   2. BUILD ASSETS (/_next/static/*)
 *      -> CACHE FIRST. Next.js content-hashed filenames deta hai
 *      (`/static/chunks/main.abc123.js`), yaani file badli = naam badla.
 *      Isliye cache-first SAFE hai: naya file = naya naam = naya fetch.
 *      REASON: inhe baar-baar network se lena bandwidth waste karta hai.
 *
 *   3. IMAGES (/icons, *.png, *.svg, *.jpg, *.webp)
 *      -> STALE-WHILE-REVALIDATE: turant cached version dikhao, background
 *      me network se refresh karo. User ko turant dikhta hai, content phir
 *      bhi fresh ho jata hai.
 *
 *   4. EVERYTHING ELSE (/api/* etc.)
 *      -> NEVER CACHE. API responses cached hone se stale data dikhta hai
 *      (purana profile, purana dashboard) - ye correctness bug hai.
 *      Auth APIs me caching bilkul nahi.
 *
 * ---------------------------------------------------------------------------
 * SAFETY NOTES
 * ---------------------------------------------------------------------------
 * - `CACHE_VERSION` badlao jaye to purana cache automatically invalid ho
 *   jata hai (activate me purane delete). Naya version = fresh deploy.
 * - SW sirf `https` + `localhost` par activate hota hai. Baaki origins par
 *   `register()` fail hoga - ye `register()` ke andar hi check hai.
 * - Ye SW kabhi POST/PUT/DELETE ko touch nahi karta (sirf GET).
 *
 * Hinglish comments: har block ka arth
 */

const CACHE_VERSION = 'v1';
const STATIC_CACHE = `wideo11-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `wideo11-runtime-${CACHE_VERSION}`;

const CORE_ASSETS = ['/', '/auth/login', '/offline.html'];

self.addEventListener('install', (event) => {
  // NOTE: `waitUntil` se install tabhi complete hota hai jab core assets
  // cache ho jayein. Best-effort hai - koi ek asset fail ho to bhi SW
  // install ho jata hai.
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .catch((err) => {
        // Log only - SW install ko fail nahi karte, warna app hi offline
        // ho jayegi.
        console.warn('[SW] Core asset precache skipped:', err && err.message);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Purane caches delete karo (stale JS bundles serve hone se bachata hai)
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** Sirf GET requests ko handle karo (POST/PUT ko chhedna nahi hai) */
function isGet(request) {
  return request.method === 'GET';
}

/** Static build asset? (content-hashed, cache-first safe) */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image')
  );
}

/** Image asset? (stale-while-revalidate) */
function isImage(url) {
  return /\.(?:png|jpg|jpeg|svg|webp|avif|ico)$/i.test(url.pathname);
}

/** API request? (NEVER cache - correctness) */
function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // ---- Sirf GET ----
  if (!isGet(request)) return;

  const url = new URL(request.url);

  // ---- Cross-origin: bilkul touch mat karo ----
  // (MinIO, Google Fonts etc. - inka apna caching hota hai, humara nahi)
  if (url.origin !== self.location.origin) return;

  // ---- API: KABHI cache mat karo ----
  if (isApi(url)) return;

  // ---- Static build assets: CACHE FIRST ----
  // (content-hashed filenames: naya content = naya naam, isliye safe)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // ---- Images: STALE-WHILE-REVALIDATE ----
  if (isImage(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response && response.ok) cache.put(request, response.clone());
              return response;
            })
            .catch(() => cached);
          // Cached mila to turant wahi return karo (network background me)
          return cached || network;
        })
      )
    );
    return;
  }

  // ---- Navigations: NETWORK FIRST, cache fallback ----
  // (freshness preferred; purana page sirf tab jab offline ho)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => {
            if (cached) return cached;
            // Last resort: dedicated offline page
            return caches.match('/offline.html').then(
              (offline) =>
                offline ||
                new Response(
                  '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
                    '<body style="font-family:system-ui;background:#111217;color:#d8d9da;' +
                    'display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
                    '<div><h1 style="font-size:18px">You are offline</h1>' +
                    '<p style="color:#9fa7b3">Reconnect to continue.</p></div></body>',
                  { headers: { 'Content-Type': 'text/html' } }
                )
            );
          })
        )
    );
  }
});
