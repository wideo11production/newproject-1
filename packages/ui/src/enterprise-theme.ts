/**
 * ENTERPRISE THEME - single source of truth (Choice A: unified tokens, unique structure)
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
 * typography, radius, shadows, animations - sab ek hi enterprise tone me.
 *
 * CHOICE A: Tokens UNIFIED, structure UNIQUE.
 *   - Tokens (color/typography/radius/animation) -> yahan se, sab same
 *   - Content globs aur page structure -> har app apna rakhta hai
 *     (editor Movavi-style rahega, monitor Grafana-console rahega)
 *
 * Hinglish comments: har block ka arth
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
      // ---- shadcn semantic tokens (CSS variables se) ----
      border: 'hsl(var(--border))',
      input: 'hsl(var(--input))',
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
        bg: '#111217',        // app background
        panel: '#181b1f',     // card / panel
        panelHover: '#1f2227',// panel hover state
        border: '#2c3235',    // subtle border
        text: '#d8d9da',      // primary text
        textMuted: '#9fa7b3',// secondary text
        primary: '#5794f2',   // action / accent blue
        success: '#73bf69',   // healthy
        warning: '#f2cc0c',   // caution
        danger: '#f2495c',    // critical / breach
        info: '#8ab8ff',
      },

      // ---- Surface scale (cards, borders) ----
      surface: {
        DEFAULT: '#181b1f',
        raised: '#1f2227',
        sunken: '#0d0f11',
      },
    },

    borderRadius: {
      lg: 'var(--radius)',
      md: 'calc(var(--radius) - 2px)',
      sm: 'calc(var(--radius) - 4px)',
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
