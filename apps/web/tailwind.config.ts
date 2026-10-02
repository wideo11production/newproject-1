// web tailwind config
// CHOICE A: Unified tokens, unique structure.
//   - theme   -> shared enterprise theme (color/typography/animation SAB SAME)
//   - content -> app-specific globs (har app ka apna structure rahega)
// Hinglish: theme shared hai, structure har app ka apna hai
import type { Config } from 'tailwindcss';
import path from 'path';
import { enterpriseTheme } from '@wideo11/ui/enterprise-theme';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',
    // FIX: `@wideo11/ui` ke components bhi is app ka UI hain (Card, Button,
    // Input, Checkbox, Progress ...). Inka source `packages/ui/src` me hai,
    // jo upar ke app-only globs se scan hi nahi hota tha.
    //
    // Isi wajah se auth/register ka form card invisible tha: `Card` component
    // `bg-card text-card-foreground` render karta hai, par wo classes
    // `packages/ui` me likhi hui hain - to Tailwind unhe generate hi nahi
    // karta tha. `bg-card` missing => card ka background transparent.
    //
    // NOTE: `path.resolve(__dirname, ...)` zaroori hai. Tailwind content globs
    // ko `process.cwd()` se resolve karta hai, aur Next.js postcss pipeline
    // me cwd app root guarantee nahi karta - isliye plain '../../packages/...'
    // glob chup-chaap kuch na kuch scan karta reh gaya.
    path.resolve(__dirname, '../../packages/ui/src/**/*.{ts,tsx}'),
  ],
  theme: enterpriseTheme,
  plugins: [
    require('tailwindcss-animate')
  ],
};

export default config;