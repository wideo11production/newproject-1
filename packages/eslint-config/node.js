const baseConfig = require("./index.js");

module.exports = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        browser: false,
        node: true,
        es2022: true,
      },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "off",
      "jsx-a11y/anchor-is-valid": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];