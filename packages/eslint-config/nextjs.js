const baseConfig = require("./index.js");
const nextPlugin = require("@next/eslint-plugin-next");
const hexLiteralAllowed = require("./hex-literal-allowed.js");

// ---------------------------------------------------------------------------
// DESIGN PLUGIN — flat config mein plugins PER-OBJECT hote hain, global nahi
// ---------------------------------------------------------------------------
//
// Ye ek asli bug tha. Plugin sirf pehle config object mein register kiya gaya tha
// (jiska koi `files` nahi), aur baad mein do override objects uske rule use kar
// rahe the. ESLint 8 flat config mein plugin sirf USI object mein dikhta hai jisme
// declare hua — isliye neeche wale blocks "Could not find plugin wideo11" dete the.
//
// Isiliye ek `designPlugin` constant banaya aur har object mein spread kiya gaya.
// Aage koi naya `files` block is rule ko use kare to bas ye spread karna hai.
const designPlugin = {
  "wideo11-design": {
    rules: {
      "hex-literal-allowed": hexLiteralAllowed,
    },
  },
};

module.exports = [
  ...baseConfig,

  // ---------------------------------------------------------------------------
  // DESIGN PLUGIN — apna alag object, koi `files`/`rules` nahi
  // ---------------------------------------------------------------------------
  //
  // Ye pehle base object ke andar tha (`@next/next` ke saath), aur rule usi
  // object ke `rules` mein nahi thi — sirf plugin register tha. Neeche wale do
  // override objects is plugin ke rule use karte hain, aur ESLint 8 flat config
  // mein plugin sirf USI object mein dikhta hai jisme declare hua.
  //
  // Isliye: ek DEDICATED object jiska kaam sirf "ye plugin maujood hai" kehna hai.
  // Isse koi farq nahi padta ki rule kis object mein likha hai.
  {
    plugins: { ...designPlugin },
  },

  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      "@next/next/no-html-link-for-pages": "error",
      "@next/next/no-img-element": "error",
      "@next/next/no-page-custom-font": "warn",
      "@next/next/no-script-component-in-head": "warn",
      "@next/next/no-duplicate-head": "warn",
    },
  },

  // ---------------------------------------------------------------------------
  // DESIGN TOKEN ENFORCEMENT — hardcoded hex
  // ---------------------------------------------------------------------------
  //
  // ---- PATH MATCHING: `**/` PREFIX KYUN ----
  //
  // Ye config SHARED hai — har app ise apni root se extend karta hai. Matlab
  // `files: ["apps/web/src/..."]` tab match karta jab config repo root se chale,
  // aur FAIL hota jab wahi config `apps/web` ke andar se chale (jo asli case hai,
  // kyunki `pnpm lint` app ki directory mein chalta hai).
  //
  // Isiliye pattern app-relative hai, config-relative nahi: `**/components/studio/**`.
  //
  // ---- DO LEVELS, AUR KYUN ----
  //
  //   ERROR  `components/studio/**` — wahan se purge shuru hota hai. Inhe turant
  //          migrate karna hai.
  //   WARN   baaki sab — 66 files, 1559 hex. Yahan WARN, taaki repo ek saath toot
  //          ke "sab band karo" na ho jaaye. Migrate hote hi ERROR ho jaayenge.
  //
  // Ye ek deliberate two-phase hai: pehle naya code saaf, phir purana. Ek hi din
  // mein 1559 hex theek karne ka diff koi review nahi kar sakta.
  //
  // ---- `design-system.ts` EXEMPT KYUN NAHI ----
  //
  // Token file hex DEFINE karti hai, isliye usse exempt kiya ja raha hai — rule ke
  // andar, filename check se. Ek `files` ignore se galat hota: naya hex wahan add
  // ho sakta hai bina token baney, aur rule chup ho jaati.
  {
    files: ["**/components/studio/**/*.{ts,tsx}"],
    plugins: { ...designPlugin },
    rules: {
      "wideo11-design/hex-literal-allowed": "error",
    },
  },
  {
    files: ["**/src/**/*.{ts,tsx}"],
    ignores: ["**/components/studio/**", "**/design-system.ts"],
    plugins: { ...designPlugin },
    rules: {
      "wideo11-design/hex-literal-allowed": "warn",
    },
  },
];