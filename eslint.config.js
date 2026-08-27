const js = require("@eslint/js");
const globals = require("globals");
const reactHooks = require("eslint-plugin-react-hooks");
const reactRefresh = require("eslint-plugin-react-refresh").default;
const tseslint = require("typescript-eslint");

const typedFiles = ["apps/api/**/*.ts", "apps/web/**/*.{ts,tsx}"];

module.exports = tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/generated/**",
      ".codex-tmp/**",
      "tmp/**",
      "vendor/**",
      "setup/**",
      "drivers/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: typedFiles,
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  {
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        project: [
          "./apps/api/tsconfig.json",
          "./apps/api/test-support/tsconfig.integration.json",
          "./apps/web/tsconfig.app.json",
          "./apps/web/tsconfig.node.json",
        ],
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["apps/api/*.config.ts", "apps/web/*.config.ts"],
  },
  {
    files: ["apps/api/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    ...reactRefresh.configs.vite,
    files: ["apps/web/src/**/*.{ts,tsx}"],
    rules: {
      ...reactRefresh.configs.vite.rules,
      "react-refresh/only-export-components": [
        "error",
        {
          allowConstantExport: true,
          allowExportNames: ["buildScheduleRanges", "applyBulkRangeSettings"],
        },
      ],
    },
  },
  {
    files: ["apps/api/**/*.test.ts", "apps/api/integration/**/*.ts", "apps/web/**/*.test.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
