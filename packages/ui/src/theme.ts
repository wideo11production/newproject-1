// The shared dark/light theme tokens.
//
// -----------------------------------------------------------------------------
// WHY THIS FILE IS THE ANSWER TO A BUG NOBODY HAD NAMED YET
// -----------------------------------------------------------------------------
//
// All eight apps import `enterpriseTheme` from `@wideo11/ui/enterprise-theme`, and
// that theme maps the ENTIRE `gray` scale onto nine CSS variables:
//
//     gray.50 … gray.950  ->  rgb(var(--app-ink) / <alpha-value>)
//                               rgb(var(--app-bg)  / <alpha-value>)
//                               …and so on
//
// Those nine variables were defined in EXACTLY ONE FILE IN THE REPOSITORY:
// `apps/web/src/app/globals.css`.
//
// Which means the other seven apps were compiling `bg-gray-950`, `text-gray-300`
// and `border-gray-800` into declarations like
//
//     background-color: rgb(var(--app-bg) / 1)
//
// …against a variable that does not exist. An undefined `var()` makes the whole
// declaration invalid at computed-value time, so `bg-gray-950` resolved to NOTHING.
// Those pages only looked dark because each one separately hardcoded a background
// on `body` - `superadmin/globals.css:22` had `background-color: #030712`, which
// is why nobody noticed that every utility class in the app was a no-op.
//
// The dark theme in those apps was a single hardcoded hex value wearing seven
// apps' clothing. And a light theme was not a missing feature; it was structurally
// impossible, because the variables the whole design system depends on were
// defined in somebody else's stylesheet.
//
// This module is that missing definition, as the single source of truth.
//
// -----------------------------------------------------------------------------
// WHY RGB CHANNEL TRIPLES AND NOT HEX
// -----------------------------------------------------------------------------
//
// `--app-bg: 255 255 255` rather than `--app-bg: #ffffff`, because the theme
// consumes them as `rgb(var(--app-bg) / <alpha-value>)`.
//
// That is not decoration. `bg-gray-900/50` is a 50%-opaque surface. With a hex
// variable that would need `color-mix()` or an rgba() wrapper at every call site;
// with channel triples Tailwind's `<alpha-value>` does the arithmetic and every
// opacity modifier in the codebase keeps working. Which matters, because the
// dashboard uses a lot of them: `bg-gray-900/50`, `bg-gray-950/40`,
// `bg-gray-800/30`.
//
// A hex variable would mean rewriting roughly a hundred call sites to add
// `/50` support, or silently losing every translucent panel in the product.
//
// -----------------------------------------------------------------------------
// THE TWO THEMES ARE MIRRORED, NOT INVERTED
// ------------------------------------------------------------------------------
//
// The dark palette is the Grafana enterprise surface the product is designed
// around, and it is the DEFAULT, because a monitoring dashboard is looked at for
// long stretches and dark is easier on the eyes there.
//
// The light palette is not a mechanical inversion. Each value was chosen so the
// light theme reads as the same product rather than as a washed-out dark theme:
// the greys are slightly cooler and the borders are lighter relative to the
// surface, which is what keeps a data table legible without heavy borders.
//
// Note the ORDER of the scale, which is inverted relative to Tailwind's default
// and is deliberate:
//
//     gray.50  = the STRONGEST foreground (ink)
//     gray.950 = the page BACKGROUND
//
// So `text-gray-100` is near-black on the light theme and near-white on the dark
// one, from the SAME class name. That is what lets a component be written once and
// work in both themes, and it is why the seven apps' existing markup needs no
// `dark:` variants at all. Adding `dark:` everywhere would mean two class strings
// per element and a permanent risk of writing one without the other.

/** The nine tokens, as `R G B` triples. Consumed via `rgb(var(--x) / <alpha>)`. */
export const themeTokens = {
  light: {
    '--app-bg': '255 255 255',
    '--app-surface': '249 250 251',
    '--app-surface-raised': '243 244 246',
    '--app-border': '229 231 235',
    '--app-border-strong': '209 213 219',
    '--app-ink': '17 24 39',
    '--app-fg-strong': '55 65 81',
    '--app-fg-muted': '107 114 128',
    '--app-fg-subtle': '156 163 175',
  },
  dark: {
    '--app-bg': '3 7 18',
    '--app-surface': '17 24 39',
    '--app-surface-raised': '31 41 55',
    '--app-border': '31 41 55',
    '--app-border-strong': '55 65 81',
    '--app-ink': '255 255 255',
    '--app-fg-strong': '209 213 219',
    '--app-fg-muted': '156 163 175',
    '--app-fg-subtle': '107 114 128',
  },
} as const;

export type ThemeName = keyof typeof themeTokens;

/**
 * The CSS block for one theme.
 *
 * A function rather than a template literal so an app can inline exactly one
 * theme in its `:root` and the other in its `.dark` rule. Both approaches are in
 * the repo and they disagree - `apps/web` uses `:root` = light, `apps/billing`
 * and `apps/video-editor` use `:root` = dark with a `.light` override.
 *
 * That inconsistency is not cosmetic: it means a component written as
 * `bg-gray-900` resolves to a different surface depending on which app renders
 * it, and there is no way to tell from the class name which theme you are in.
 *
 * `themeCss(theme, selector)` makes the choice explicit at the call site instead
 * of implied by file history. Dark is the default theme here, so apps should emit
 * `themeCss('dark', ':root')` and `themeCss('light', '.light')` - which also means
 * a page with NO theme class at all renders dark rather than light. Failing toward
 * dark is the right default for a dashboard: it is the theme the design is built
 * around, and an unstyled flash of white on a monitoring surface is worse than a
 * flash of dark.
 */
export function themeCss(theme: ThemeName, selector: string): string {
  const tokens = themeTokens[theme];
  const body = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `${selector} {\n${body}\n}`;
}

/**
 * Both themes, with dark on `:root` and light on `.light`.
 *
 * The counterpart to `themeCss` for apps that just want the pair. Exported
 * separately because it is the shape most apps want and the individual form is
 * the one you reach for when you need a third selector.
 */
export function themePairCss(): string {
  return `${themeCss('dark', ':root')}\n${themeCss('light', '.light')}`;
}

/**
 * The blocking script that applies the stored theme before first paint.
 *
 * WHY IT IS A RAW STRING AND NOT A COMPONENT
 *
 * Because it must run BEFORE the browser paints, which means in `<head>`, before
 * React hydrates. A `useEffect` runs after paint, and the visible result is a
 * flash of the wrong theme - on a dark dashboard that is a white flash on every
 * navigation, which reads as a bug even when it lasts 80ms.
 *
 * It is deliberately tiny and dependency-free: no framework, no storage library,
 * no hydration mismatch, because it touches `documentElement` before React ever
 * sees it. `suppressHydrationWarning` on `<html>` is still required, because the
 * server rendered one class and the client ends up with another.
 *
 * IT FAILS SAFE. Every access is wrapped: a browser with localStorage disabled
 * (Safari private browsing historically, some corporate policies) throws on
 * `getItem`, and an exception here would abort the script and leave the page
 * unthemed. Wrapping means a storage failure degrades to "use the system
 * preference", which is a working page rather than a broken one.
 *
 * It also sets `colorScheme`, which CSS variables do not reach: browser scrollbars,
 * form-control chrome and autofill styling all follow this, not the palette.
 * Without it a dark page gets a white scrollbar and light-coloured `<select>`
 * dropdowns, which is the single most common way a "dark mode" looks unfinished.
 */
export const themeInitScript: string = `
(function () {
  try {
    var stored = localStorage.getItem('wideo11-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    var root = document.documentElement;
    root.classList.remove('light');
    if (theme === 'light') root.classList.add('light');
    root.style.colorScheme = theme;
  } catch (e) {
    // Storage unavailable. Dark is the default the design is built around, and an
    // unthemed page is better than a page whose theming script threw.
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`.trim();

/** The localStorage key. One name for the whole product, on purpose. */
export const THEME_STORAGE_KEY = 'wideo11-theme';
