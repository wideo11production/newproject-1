// PostCSS pipeline for the analytics app.
//
// Same bug as `web` and `monitor` had: without this file Next.js finds no
// PostCSS config, passes stylesheets through UNPROCESSED, and the shipped CSS
// literally contains `@tailwind base;@tailwind components;@tailwind
// utilities;` - which the browser ignores. The page renders as unstyled HTML
// while every HTTP check reports 200.
//
// This is the THIRD app to be bitten. If a fourth appears, move this to a
// single shared config and have the apps extend it, rather than a fourth copy.
//
// `postcss-import` is required so the shared scrollbar stylesheet
// (`@wideo11/ui/src/styles/scrollbar.css`) is inlined into the production
// bundle. Without it the @import is dropped silently - no error, just missing
// styles.
//
// Hinglish: is file ke bina Tailwind chalta hi nahi
const config = {
  plugins: {
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
