/**
 * GLOBAL FONT STACK - Grafana-style, air-gapped (no network needed)
 *
 * KYUN YE ZAROORI HAI:
 * Pehle 4 apps "next/font/google" se Inter font import karte the. Next.js build
 * time par Google Fonts se fetch karta hai. Jab network slow/blocked hota hai,
 * to build POORI tarah fail ho jaati thi:
 *
 *   "next/font error: Failed to fetch `Inter` from Google Fonts."
 *   (ECONNRESET)
 *
 * Ye sirf "cosmetic" issue nahi tha - ye PRODUCTION BUILD BLOCKER tha, aur is
 * project me ek baar isne build actually fail kar di thi.
 *
 * AB: Koi external font fetch nahi. Ye stack har modern OS pe native fonts
 * use karti hai (Windows -> Segoe UI, macOS -> San Francisco, Linux -> system-ui).
 * Result: zero network dependency, instant build, aur Grafana jaisa clean look.
 *
 * HYBRID ENVIRONMENT NOTE:
 * Frontends ab `pnpm dev` se host machine par chalti hain (instant reload),
 * aur backend Docker me rehta hai. Air-gapped font stack dono modes me
 * consistent rendering deta hai.
 *
 * Hinglish: Google font hata diya - ab koi network call nahi, build kabhi fail nahi hogi
 */
export const FONT_SANS_STACK =
  "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/**
 * FONT_SANS_CLASS - Tailwind className jo ye stack apply karta hai
 *
 * Tailwind ka `font-sans` default stack ko override karta hai. Ye value
 * `fontFamily.sans` ke roop me tailwind.config me bhi set ho sakti hai,
 * lekin body className se direct apply karna zyada reliable hai - wo har
 * layout me bina config change ke kaam karta hai.
 *
 * Hinglish: ye class body tag pe lagte hi poori app ka font change ho jata hai
 */
export const FONT_SANS_CLASS = 'font-sans';
