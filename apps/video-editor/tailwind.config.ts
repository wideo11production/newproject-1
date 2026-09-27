// video-editor tailwind config
// CHOICE A: Unified tokens, unique structure.
//   - theme   -> shared enterprise theme (color/typography/animation SAB SAME)
//   - content -> app-specific globs (har app ka apna structure rahega)
// Hinglish: theme shared hai, structure har app ka apna hai
import type { Config } from 'tailwindcss';
import { enterpriseTheme } from '../../packages/ui/src/enterprise-theme';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx}',
  ],
  theme: enterpriseTheme,
  plugins: [
    require('tailwindcss-animate')
  ],
};

export default config;