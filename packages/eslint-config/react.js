const baseConfig = require("./index.js");

module.exports = [
  ...baseConfig,
  {
    rules: {
      "react/jsx-no-useless-fragment": "warn",
      "react/self-closing-comp": "warn",
      "react/no-array-index-key": "warn",
      "react/no-unstable-nested-components": "warn",
    },
  },
];