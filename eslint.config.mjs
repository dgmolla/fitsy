import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

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
