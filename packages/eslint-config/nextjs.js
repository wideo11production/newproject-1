const baseConfig = require("./index.js");
const nextPlugin = require("@next/eslint-plugin-next");

module.exports = [
  ...baseConfig,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      "@next/next/no-html-link-for-pages": "error",
      "@next/next/no-img-element": "error",
      "@next/next/no-page-custom-font": "warn",
      "@next/next/no-script-component-in-head": "warn",
      "@next/next/no-before-interactive-script-outside-document": "warn",
      "@next/next/no-duplicate-head": "warn",
    },
  },
];