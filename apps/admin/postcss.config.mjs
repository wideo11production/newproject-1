// PostCSS pipeline for the admin (superadmin) app.
//
// Same bug as `web`, `monitor`, `analytics` and `video-editor` - the FIFTH app
// to be bitten. Without this file Next passes stylesheets through
// UNPROCESSED, shipping raw `@tailwind base;@tailwind components;@tailwind
// utilities;` directives that a browser ignores entirely. The page renders
// unstyled, and every HTTP check returns 200.
//
// This app rendered 140 CSS rules and looked fine in a headless check, which
// is exactly why it was easy to miss: unlike the other four, something in its
// build path happened to compile the directives anyway. "It looked right" is
// not the same as "it is configured" - this file is here so the styling does
// not silently disappear the next time the build path changes.
//
// Five of six frontends needed this. The sixth should get a shared config at
// the repo root rather than a sixth copy.
//
// `postcss-import` inlines the shared scrollbar stylesheet into the production
// bundle; without it the @import is dropped silently.
const config = {
  plugins: {
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
