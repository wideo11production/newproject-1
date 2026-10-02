// monitor tailwind config
// CHOICE A: Unified tokens, unique structure.
//   - theme   -> shared enterprise theme (color/typography/animation SAB SAME)
//   - content -> app-specific globs (har app ka apna structure rahega)
// Hinglish: theme shared hai, structure har app ka apna hai
import type { Config } from 'tailwindcss';
import { enterpriseTheme } from '@wideo11/ui/enterprise-theme';

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: enterpriseTheme,
  plugins: [
    require('tailwindcss-animate')
  ],
};

export default config;