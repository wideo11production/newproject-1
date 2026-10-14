/**
 * WEB — ESLint flat config
 *
 * ----------------------------------------------------------------------------
 * KYUN YE FILE HAI
 * ----------------------------------------------------------------------------
 *
 * Web app ke paas ESLint config hi NAHI tha. Koi `.eslintrc`, koi
 * `eslintConfig` key — kuch nahi. Matlab `packages/eslint-config` mein likhe
 * saare rules (import order, unused-imports, a11y, aur naya design-token rule)
 * is app par kabhi chale hi nahi. Rules likhe the, enforce koi nahi.
 *
 * Is file se web shared config extend karta hai, aur design-token rule
 * `components/studio/**` pe ERROR hai — jahan se ye migration shuru hoti hai.
 *
 * ----------------------------------------------------------------------------
 * NOTE — DEFAULT IMPORT, NAMED NAHI
 * ----------------------------------------------------------------------------
 *
 * `eslint-config-wideo11` CommonJS hai (`module.exports = [...]`), isliye ise
 * default import karke apna array spread karna padta hai. Named import
 * (`import { nextjs }`) SyntaxError deta hai — CommonJS se sirf default aata hai.
 *
 * ----------------------------------------------------------------------------
 * YE BUILD NAHI TODE GA
 * ----------------------------------------------------------------------------
 *
 * `lint` ek ALAG script hai, `build` se juda hua nahi. Isliye ye file add karne
 * se Docker build nahi rukta. Lekin `pnpm lint` chalega aur jo bhi report karega
 * woh asli hai — aur abhi STUDIO files pe error hain, kyunki unme hex abhi bhi
 * hardcoded hain. Wo migration Step 1 ka agla hissa hai.
 */

import nextjsConfig from 'eslint-config-wideo11/nextjs.js';

export default [
  ...nextjsConfig,

  // ---------------------------------------------------------------------------
  // WEB-SPECIFIC OVERRIDES
  // ---------------------------------------------------------------------------
  {
    // Next.js build output aur generated files. Inhe lint karna bekaar hai —
    // errors sirf noise denge aur asli findings chhupa denge.
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'public/**', 'coverage/**'],
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
