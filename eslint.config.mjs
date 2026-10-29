import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

// General correctness checks, shared by every application TypeScript boundary.
const correctnessRules = {
  "no-async-promise-executor": "error",
  "no-constant-binary-expression": "error",
  "no-unsafe-finally": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

const typedCorrectnessRules = {
  "@typescript-eslint/await-thenable": "error",
  // React/native event callbacks accept async handlers whose own body handles errors.
  // Still reject promises used as conditions, predicates or object spreads.
  "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
};

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
  // Tests retain syntax rules and strict tsc; typed source lint stays within 512 MB.
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
      ...correctnessRules,
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
      // Maestro flows and the L7 agent-driven verifier need stable handles;
      // warn (not error) while the codebase adopts testIDs screen by screen.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXOpeningElement[name.name=/^(Pressable|TouchableOpacity|TextInput)$/]:not(:has(JSXAttribute[name.name='testID']))",
          message: "Interactive elements need a testID so E2E flows can target them (autoship L7).",
        },
      ],
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "**/__mocks__/**", "**/test-fixtures/**"],
    languageOptions: {
      parserOptions: {
        project: "./apps/mobile/tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: typedCorrectnessRules,
  },
  // TypeScript rules for app + shared sources
  {
    files: ["apps/api/**/*.{ts,tsx}", "packages/shared/**/*.ts"],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...correctnessRules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": "warn",
    },
  },
  {
    files: ["apps/api/{app,lib,components}/**/*.{ts,tsx}", "packages/shared/**/*.ts"],
    ignores: ["**/*.test.*", "**/__mocks__/**", "**/test-fixtures/**"],
    languageOptions: {
      parserOptions: {
        project: ["./apps/api/tsconfig.eslint.json", "./packages/shared/tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: { ...typedCorrectnessRules, "@typescript-eslint/no-floating-promises": "error" },
  },
];
