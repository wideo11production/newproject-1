// PostCSS pipeline for the monitor dashboard.
//
// ---- WHY THIS FILE WAS MISSING, AND WHY IT MATTERED ----
//
// This file is what makes Next.js run Tailwind at all. Without it Next finds
// no PostCSS config, so it passes stylesheets through UNPROCESSED. The
// shipped CSS then literally contained:
//
//     @tailwind base;@tailwind components;@tailwind utilities;...
//
// which a browser ignores entirely. The page rendered - unstyled, as raw
// HTML with default browser spacing and no colours - which is what made
// "port 3001 is not working" true while every other check passed:
//
//   HTTP 200            the server was fine
//   all 10 assets 200    the JS loaded
//   /api/metrics 200     data was flowing
//   6 charts drawing     canvas had real pixels
//
// Not one of those could see the problem, because the bug was in a CSS file
// whose content was technically "loaded" successfully. The compiled output
// was 529 bytes of directives instead of ~86KB of utilities, and no HTTP
// status code anywhere reports that difference.
//
// The `web` app hit the identical bug and carries a note to this effect in its
// own postcss.config.mjs. This is the second app to be bitten by it, so if a
// third shows up, the fix belongs in a shared config rather than another
// per-app copy.
//
// ---- WHY .mjs AND NOT .js ----
//
// `apps/monitor/package.json` sets `"type": "module"`, so a `.js` file here
// would be parsed as ESM. `module.exports = {...}` would then throw
// "module is not defined" and Next would again silently skip PostCSS - the
// same failure by a different route. `.mjs` is unambiguous.
//
// Hinglish: is file ke bina Tailwire chalta hi nahi, CSS raw chala jaata hai
const config = {
  plugins: {
    // `postcss-import` PEHLE, hamesha.
    //
    // Shared stylesheet (`@wideo11/ui/src/styles/scrollbar.css`) ko inline
    // karne ke liye ye chahiye. Iske bina `@import` browser tak pahunchta hai
    // as-is, aur browser use apne origin ke hisaab se resolve karta hai -
    // jo dev me shayad chal jaye, par Docker build me production bundle me
    // file shamil nahi hoti aur scrollbar styling chup-chaap gayab ho jaati
    // hai. Koi error nahi aata. Isliye ye plugin mandatory hai, optional nahi.
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
