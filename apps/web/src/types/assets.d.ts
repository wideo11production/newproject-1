/**
 * Ambient type declarations for non-code asset imports.
 *
 * KYUN YE FILE ZAROORI HAI:
 * Next.js ke apne type definitions me `declare module '*.css'` KABHI nahi
 * hota. Humne verify kiya - next@14.2.35 ke poore `types/` tree me kahin bhi
 * CSS module ka ambient declaration nahi hai.
 *
 * Iska matlab: `import './globals.css'` ko TypeScript ke liye module ke
 * taur pe resolve karne ke liye koi type nahi hota, aur wo import editor
 * me red squiggly (TS2307 "Cannot find module './globals.css'") deta hai -
 * chahe dev server aur build dono perfectly chal rahe hon.
 *
 * Ye declaration us module ko officially type-detect karne layak banati hai.
 * Isse redline permanently khatam hoti hai - kisi bhi editor, TS version,
 * ya `next dev` / `next build` me nahi aayegi.
 *
 * Side-effect vs bound import - dono supported:
 *   import './globals.css';                 // sirf side effect
 *   import styles from './globals.css';     // CSS Modules
 *   import bg from '@/assets/bg.png';       // static asset -> string path
 *
 * Hinglish: CSS import ka type missing tha - is file ne wo supply kar diya
 */

// ---- Plain stylesheets: `import './globals.css'` ya `import s from './a.css'` ----
declare module '*.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// ---- CSS pre-processors (Tailwind isi pipeline me compile hota hai) ----
declare module '*.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.sass' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// ---- CSS Modules: `import styles from './x.module.css'` ----
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.sass' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.module.less' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// ---- Static assets: Next inhe string URL path banata hai, object nahi ----
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.avif' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.ico' {
  const src: string;
  export default src;
}

declare module '*.webmanifest' {
  const manifest: Record<string, unknown>;
  export default manifest;
}

// ---- Video / media ----
declare module '*.mp4' {
  const src: string;
  export default src;
}

declare module '*.webm' {
  const src: string;
  export default src;
}

declare module '*.mp3' {
  const src: string;
  export default src;
}

declare module '*.wav' {
  const src: string;
  export default src;
}

// ---- Fonts ----
declare module '*.woff' {
  const src: string;
  export default src;
}

declare module '*.woff2' {
  const src: string;
  export default src;
}

declare module '*.ttf' {
  const src: string;
  export default src;
}

declare module '*.otf' {
  const src: string;
  export default src;
}

declare module '*.eot' {
  const src: string;
  export default src;
}
