// PostCSS pipeline for the web app.
// KYUN YE ZAROORI THA: is file ke bina Next.js Tailwind ko run hi nahi karta tha,
// to `src/app/globals.css` ke `@tailwind` aur `@apply` directives raw reh jaate the
// aur compiled stylesheet (`layout.css`) 404 de deti thi.
// Baaki har app (admin, billing, currency, superadmin) ke paas ye file hai - web
// se hi chhoot gayi thi, isliye layout ne apna CSS hi nahi load kar paaya.
//
// `postcss-import` shared stylesheets inline karne ke liye zaroori hai
// (`@wideo11/ui/src/styles/scrollbar.css`). Iske bina `@import` production
// bundle me file shamil nahi hoti - koi error nahi, bas styling gayab.
const config = {
  plugins: {
    'postcss-import': {},
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
