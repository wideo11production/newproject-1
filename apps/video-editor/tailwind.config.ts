// video-editor tailwind config
// CHOICE A: Unified tokens, unique structure.
//   - theme   -> shared enterprise theme (color/typography/animation SAB SAME)
//   - content -> app-specific globs (har app ka apna structure rahega)
// Hinglish: theme shared hai, structure har app ka apna hai
import type { Config } from 'tailwindcss';
import { enterpriseTheme } from '@wideo11/ui/enterprise-theme';

const base = enterpriseTheme as Config['theme'];

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
  ],
  // ---- Semantic aliases over the shared theme ----
  //
  // Every surface in the editor is one of five roles: the workspace, a raised
  // panel, an overlay, a border, or text. Naming them means the light theme is
  // a variable swap instead of a second copy of the component tree.
  //
  // This exists because the panels were first written with literal slate
  // classes. Under `.light` the page went white and the toolbar stayed
  // `rgb(15,23,42)` - a theme that claimed to be light and was not. The token
  // names below are the fix; the aliases point at the same values the editor
  // already used, so the dark theme is pixel-identical.
  theme: {
    ...base,
    extend: {
      colors: {
        ...(base?.extend?.colors ?? (base as { colors?: Record<string, unknown> })?.colors ?? {}),
        // `rgb(var(--ve-*) )`, NOT `var(--ve-*)`.
        //
        // The token values are RGB channel triples, because that is what the
        // opacity-aware `rgb(var(--x) / <alpha-value>)` form needs. Handing
        // Tailwind a bare `var()` produces `background-color: 2 6 23`, which is
        // not a colour, so the element silently renders transparent - and a
        // transparent toolbar in a light theme looks like nothing at all.
        //
        // The `ve-` prefix is not decoration. The shared theme's tokens are
        // HSL channel triples consumed as `hsl(var(--x))`; reusing one of those
        // names here would feed `rgb(217.2 32.6% 17.5%)` to `rgb()`, which
        // parses happily and paints dark red - a wrong-colour bug with no error
        // to find it by.
        surface: 'rgb(var(--ve-surface))',
        'surface-raised': 'rgb(var(--ve-surface-raised))',
        'surface-overlay': 'rgb(var(--ve-surface-overlay))',
        'surface-sunken': 'rgb(var(--ve-surface-sunken))',
        edge: 'rgb(var(--ve-edge))',
        'edge-strong': 'rgb(var(--ve-edge-strong))',
        fg: 'rgb(var(--ve-text-primary))',
        'fg-secondary': 'rgb(var(--ve-text-secondary))',
        'fg-muted': 'rgb(var(--ve-text-muted))',
      },
      borderColor: {
        DEFAULT: 'rgb(var(--ve-edge))',
      },
      ringColor: {
        DEFAULT: 'rgb(var(--ring))',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate')
  ],
};

export default config;