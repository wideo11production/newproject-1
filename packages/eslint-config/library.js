const baseConfig = require("./index.js");
const reactConfig = require("./react.js");

module.exports = [
  ...baseConfig,
  ...reactConfig,
  {
    rules: {
      "import/no-extraneous-dependencies": [
        "error",
        {
          devDependencies: [
            "**/*.test.ts",
            "**/*.test.tsx",
            "**/*.spec.ts",
            "**/*.spec.tsx",
            "**/*.stories.tsx",
            "**/.storybook/**",
          ],
        },
      ],
    },
  },
];