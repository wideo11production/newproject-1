/**
 * ============================================================================
 * `next` PARAMETER - SAFE DESTINATION HELPER
 * ============================================================================
 *
 * Ye helper `?next=` ko ek SAFE internal path me convert karta hai.
 *
 * ----------------------------------------------------------------------------
 * YE KYUN ZAROORI HAI (security)
 * ----------------------------------------------------------------------------
 *
 * `next` user-controlled hai. Agar ise bina check kiye `window.location.href`
 * par daal diya jaye, to wo ek OPEN REDIRECT ban jata hai:
 *
 *   /auth/login?next=https://evil.example/steal
 *
 * Victim apna legit session ke saath us link par click kare -> browser us
 * domain par le gaya -> wahan attacker ka page access token mangwa sakta hai
 * (agar wo URL fragment/query me token forward kare, ya victim khud
 * credentials wahan daale - dono classic phishing flows hain).
 *
 * Isliye rule: `next` sirf WEBSITE KA APNA relative path ho sakta hai.
 * Absolute URL, protocol-relative `//host`, aur `/\host` (jo kuch browsers
 * protocol-relative maarte hain) - teeno REJECT.
 *
 * ----------------------------------------------------------------------------
 * YE `next` PARAM KAHAN-KAHAN BROKEN THA
 * ----------------------------------------------------------------------------
 *
 * Register page `?next=` ko HONOUR karti thi (`auth/register/page.tsx`), lekin:
 *
 *   1. `auth/login/page.tsx` - login ke baad HAR BAAR hardcoded `/dashboard`
 *      par jaati thi. `?next=` bilkul ignore hota tha. Toh video-editor gate se
 *      aaya user login karne ke baad editor par wapas nahi jaata tha.
 *
 *   2. `src/middleware.ts` - unauthenticated user ko `/auth/login` par bhejte
 *      waqt `next` DROP kar deta tha. Gate ka `?next=` redirect se pehle hi
 *      kho jaata tha, isliye login page tak pahunchte hi nahi.
 *
 * Net effect: editor gate se aane wala user login ke baad apni destination
 * bhool jaata tha. Ab dono jagah ye same helper use karte hain.
 *
 * ----------------------------------------------------------------------------
 * NOTE: ye module EDGE runtime friendly hai - koi Node-only import nahi, sirf
 * string logic. Isliye `src/middleware.ts` (Edge) aur client components dono
 * ise import kar sakte hain.
 */

/** Default destination jab `next` missing ya unsafe ho. */
export const DEFAULT_NEXT = '/dashboard';

/**
 * Auth pages jinpe `next` bhejna khud ko redirect loop bana dega.
 *
 * `/auth/login?next=/auth/login` - user login page par hi wapas aayega, page
 * dobara redirect karega, aur user ko koi error bhi nahi dikhega. Ye silent
 * trap hai, isliye inhe bhi reject karte hain.
 */
const LOOPING_PATHS = new Set(['/auth/login', '/auth/register', '/auth/logout']);

/**
 * `next` ko safe internal destination me badlo.
 *
 * @param raw - raw `next` query value (string | null | undefined)
 * @returns safe same-origin path, ya `DEFAULT_NEXT`
 *
 * @example
 *   safeNext('/dashboard')            // -> '/dashboard'
 *   safeNext('https://evil.com')      // -> '/dashboard'  (rejected)
 *   safeNext('//evil.com')            // -> '/dashboard'  (rejected)
 *   safeNext('/\\evil.com')           // -> '/dashboard'  (rejected)
 *   safeNext(null)                    // -> '/dashboard'
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_NEXT;

  // Control characters (incl. \n, \r, \t, NUL) - header/URL injection ke liye.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return DEFAULT_NEXT;

  // Sirf relative path - absolute URL (`https://...`) aur backslash forms reject.
  if (!raw.startsWith('/')) return DEFAULT_NEXT;

  // `//evil.com` protocol-relative hai -> browser dusre host par chala jayega.
  // `/\evil.com` bhi: kuch browsers ise `//` ki tarah normalize karte hain.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_NEXT;

  // Loop se bachao.
  const pathOnly = raw.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  if (LOOPING_PATHS.has(pathOnly)) return DEFAULT_NEXT;

  return raw;
}

/**
 * Browser me chalne wale code ke liye `?next=` padhne ka shortcut.
 *
 * Client components me `useSearchParams()` Suspense boundary mangata hai, jo
 * in pages par extra complexity banata hai. Ye helper direct `window.location`
 * se value uthata hai, aur `safeNext` se guzarta hai.
 *
 * NOTE: ye sirf client-side (browser) me call hona chahiye - server render par
 * `window` undefined hota hai.
 */
export function nextFromLocation(): string {
  if (typeof window === 'undefined') return DEFAULT_NEXT;
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}