/**
 * MOVAVI-STYLE ENTERPRISE THEME - single source of truth
 *
 * KYUN YE HAI:
 * 9 apps ke apne-apne tailwind.config.ts the, aur wo ek doosre se DRIFT kar
 * chuke the:
 *   - kuch me sirf 2 keyframes the, kuch me 6
 *   - kuch me `grafana.*` palette thi, kuch me nahi
 *   - font variable bhi alag tha (`--font-inter` vs `--font-sans`)
 * Iska matlab: ek hi platform par buttons/alerts alag dikhte the.
 *
 * AB: ye file SAARI apps import karti hain. Color, button, badge, alert,
 * typography, radius, shadows, animations - sab ek hi MOVAVI enterprise tone me.
 *
 * MOVAVI BORDERLESS DESIGN PHILOSOPHY:
 * - NO borders anywhere - sections are differentiated by background contrast only
 * - Deep Pitch Black (#0a0a0a) = preview/display areas
 * - Rich Charcoal (#1a1a1a) = sidebars/chrome strips
 * - Lighter Greyish-Black (#2a2a2a) = timeline tracks/layout grids
 * - Orange-Red (#ff6500) = active/hover/selected accents
 * - rounded-md (0.5rem) = uniform corner radius across all elements
 */

import type { Config } from 'tailwindcss';

/**
 * Grafana-inspired dark palette (enterprise single tone)
 *
 * Ye values wahi hain jo shared config me pehle se thi - bas ab har app
 * actually inherit karegi, instead of har app me copy-paste hona.
 */
export const enterpriseTheme = {
  extend: {
    colors: {
      // ---- THEME-AWARE GRAY SCALE (light/dark dono me chalti hai) ----
      //
      // KYUN YE ZAROORI HAI:
      // Poore app me ~450 jagah hardcoded `bg-gray-950` / `text-gray-400` /
      // `border-gray-800` jaise classes likhe gaye hain. Ye Tailwind ke STATIC
      // hex values the, isliye `.dark` class toggle karne se ye KABHI nahi
      // badal-te the - sirf wahi elements badle jo CSS variables use karte
      // the (shadcn tokens). Isi wajah se light mode me "sirf kuch cheezein"
      // hi badalti thi - baaki app dark hi rehta tha.
      //
      // AB: gray scale CSS variables se aati hai. `:root` (light) aur `.dark`
      // me in values ko alag-alag define kiya gaya hai, to ek hi class list
      // poori app ko light AUR dark dono me sahi dikhati hai - bina 450 files
      // me ek bhi class badle.
      //
      // !!!!! BAHUT ZAROORI: RGB CHANNEL FORMAT !!!!!
      // Values ko `3 7 18` (space-separated channels) me rakhna ZAROORI hai,
      // `3 7 18 / 0.6` ya `hsl(...)` NAHI.
      //
      // Agar `var(--app-bg)` ko poora color value (`#030712` ya `hsl(...)`)
      // ki tarah doge, to Tailwind OPACITY MODIFIER (`bg-gray-950/60`,
      // `bg-gray-900/70`) ko resolve hi nahi kar pata - wo class CSS me
      // generate hi nahi hoti, chup-chaap. Isse card ka background, input ka
      // background, sab gayab ho jate hain aur input me browser ka default
      // light background aa jaata hai (dark theme pe bhi).
      //
      // `<alpha-value>` placeholder hi wo magic hai jo Tailwind ko
      // `rgb(var(--app-bg) / 0.6)` banane deta hai - yahi shadcn ka bhi
      // standard pattern hai. Isliye ye file `hsl(var(--...))` wale purane
      // tokens se bhi IMPORTANT hai.
      //
      // Note ki text colors INVERT hote hain:
      //   dark  mode: gray-400 = halka (156 163 175) - dark bg pe readable
      //   light mode: gray-400 = gehra (107 114 128) - white bg pe readable
      // Isi wajah se "kam number = zyada contrast against surface" dono
      // themes me sahi rehta hai.
      gray: {
        50: 'rgb(var(--app-ink) / <alpha-value>)',
        100: 'rgb(var(--app-ink) / <alpha-value>)',
        200: 'rgb(var(--app-ink) / <alpha-value>)',
        300: 'rgb(var(--app-fg-strong) / <alpha-value>)',
        400: 'rgb(var(--app-fg-muted) / <alpha-value>)',
        500: 'rgb(var(--app-fg-subtle) / <alpha-value>)',
        600: 'rgb(var(--app-border-strong) / <alpha-value>)',
        700: 'rgb(var(--app-border) / <alpha-value>)',
        800: 'rgb(var(--app-surface-raised) / <alpha-value>)',
        900: 'rgb(var(--app-surface) / <alpha-value>)',
        950: 'rgb(var(--app-bg) / <alpha-value>)',
      },

      // ---- APP INK (primary text on app background) ----
      //
      // `text-white` ko humne JAAN-BUJH KAR nahi badla, kyunki wo ~90 jagah
      // colored buttons (bg-blue-600 etc.) pe text ke liye use hota hai -
      // unhe hamesha white hi rehna chahiye. Isliye app-background pe primary
      // text ke liye dedicated `ink` token banaya gaya hai.
      ink: 'rgb(var(--app-ink) / <alpha-value>)',

      // ---- shadcn semantic tokens (CSS variables se, borderless override) ----
      // KYUN: Ab koi border nahi - sirf background contrast.
      // `border` aur `input` variables empty string me set karo gaye
      // global CSS me, taaki koi bhi border-visible effect na bana.
      border: 'transparent',
      input: 'transparent',
      ring: 'hsl(var(--ring))',
      background: 'hsl(var(--background))',
      foreground: 'hsl(var(--foreground))',
      primary: {
        DEFAULT: 'hsl(var(--primary))',
        foreground: 'hsl(var(--primary-foreground))',
      },
      secondary: {
        DEFAULT: 'hsl(var(--secondary))',
        foreground: 'hsl(var(--secondary-foreground))',
      },
      destructive: {
        DEFAULT: 'hsl(var(--destructive))',
        foreground: 'hsl(var(--destructive-foreground))',
      },
      muted: {
        DEFAULT: 'hsl(var(--muted))',
        foreground: 'hsl(var(--muted-foreground))',
      },
      accent: {
        DEFAULT: 'hsl(var(--accent))',
        foreground: 'hsl(var(--accent-foreground))',
      },
      popover: {
        DEFAULT: 'hsl(var(--popover))',
        foreground: 'hsl(var(--popover-foreground))',
      },
      card: {
        DEFAULT: 'hsl(var(--card))',
        foreground: 'hsl(var(--card-foreground))',
      },

      // ---- Grafana stack (unified enterprise tone) ----
      grafana: {
        bg: '#0a0a0a',         // MOVAVI Deep Pitch Black - preview/display areas
        panel: '#1a1a1a',      // MOVAVI Rich Charcoal - sidebars/chrome strips
        panelHover: '#2a2a2a', // MOVAVI Lighter Greyish-Black - hover state
        border: '#00000000',   // MOVAVI: NO borders - borderless policy
        text: '#d8d9da',       // primary text
        textMuted: '#9fa7b3',  // secondary text
        primary: '#ff6500',    // MOVAVI orange-red accent
        success: '#73bf69',    // healthy
        warning: '#f2cc0c',    // caution
        danger: '#f2495c',     // critical / breach
        info: '#8ab8ff',
      },

      // ---- Surface scale (cards, backgrounds) - MOVAVI palette ----
      surface: {
        DEFAULT: '#1a1a1a',    // Rich Charcoal - main panels
        raised: '#2a2a2a',     // Lighter Greyish-Black - raised elements
        sunken: '#0a0a0a',     // Deep Pitch Black - preview areas
      },
    },

    borderRadius: {
      lg: '0.5rem',  // MOVAVI: rounded-md everywhere
      md: '0.5rem',  // MOVAVI: rounded-md everywhere
      sm: '0.5rem',  // MOVAVI: rounded-md everywhere
    },

    fontFamily: {
      // NOTE: har app pehle alag font var use kar raha tha
      // (--font-inter vs --font-sans). Ab single stack hai.
      // Air-gapped: koi Google Fonts fetch nahi - system fonts.
      sans: [
        'ui-sans-serif',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        'Segoe UI',
        'Roboto',
        'Helvetica Neue',
        'Arial',
        'sans-serif',
      ],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
    },

    keyframes: {
      'accordion-down': {
        from: { height: '0' },
        to: { height: 'var(--radix-accordion-content-height)' },
      },
      'accordion-up': {
        from: { height: 'var(--radix-accordion-content-height)' },
        to: { height: '0' },
      },
      'fade-in': {
        from: { opacity: '0' },
        to: { opacity: '1' },
      },
      'fade-out': {
        from: { opacity: '1' },
        to: { opacity: '0' },
      },
      'slide-in-from-top': {
        from: { transform: 'translateY(-100%)' },
        to: { transform: 'translateY(0)' },
      },
      'slide-in-from-bottom': {
        from: { transform: 'translateY(100%)' },
        to: { transform: 'translateY(0)' },
      },
      // Standardized pulse - alerts aur status indicators ke liye
      'pulse-soft': {
        '0%, 100%': { opacity: '1' },
        '50%': { opacity: '0.7' },
      },
    },

    animation: {
      'accordion-down': 'accordion-down 0.2s ease-out',
      'accordion-up': 'accordion-up 0.2s ease-out',
      'fade-in': 'fade-in 0.2s ease-out',
      'fade-out': 'fade-out 0.2s ease-out',
      'slide-in-from-top': 'slide-in-from-top 0.3s ease-out',
      'slide-in-from-bottom': 'slide-in-from-bottom 0.3s ease-out',
      'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
    },

    boxShadow: {
      // Panel depth - cards ko Grafana jaisa layered look deta hai
      panel: '0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)',
      'panel-hover': '0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.3)',
    },
  },
} satisfies Config['theme'];
