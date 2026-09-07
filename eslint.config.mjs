import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  // Global ignores (no `files` key = applies everywhere)
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "**/dist/**",
      "**/next-env.d.ts",
    ],
  },
  // Mobile: type-aware parsing is too slow for RN's tree and jest-expo mocks;
  // parse without a project. Same rule intent as api; deviations noted inline.
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      // Jest manual mocks under __mocks__/ legitimately use require()
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "warn",
    },
  },
  // TypeScript rules for app + shared sources
  {
    files: ["apps/api/**/*.{ts,tsx}", "packages/shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["./apps/api/tsconfig.json", "./packages/shared/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": "warn",
    },
  },
];
