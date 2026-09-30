// PostCSS pipeline for the video-editor app.
//
// Same bug as `web`, `monitor` and `analytics` had, and this is the FOURTH
// app to be bitten. Without this file Next.js finds no PostCSS config, passes
// stylesheets through UNPROCESSED, and the shipped CSS contains literally:
//
//     @tailwind base;@tailwind components;@tailwind utilities;
//
// which a browser ignores. The page still renders - with default browser
// spacing, no colours, no layout - and every HTTP check returns 200. Verified
// on this app before the fix: 12 CSS rules, styling not applied, editor
// toolbar and media lists rendering as raw unstyled text.
//
// That is four out of six frontends. The next one should NOT need this file:
// move the plugin list to a shared `postcss.config.base.mjs` at the repo root
// and have each app re-export it. Four copies is already a pattern, not a
// design.
//
// `postcss-import` inlines the shared scrollbar stylesheet
// (`@wideo11/ui/src/styles/scrollbar.css`) into the production bundle.
// Without it the @import is dropped silently - no error, just missing styles.
const config = {
  plugins: {
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
