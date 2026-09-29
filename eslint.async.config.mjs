// Type-aware checks for promises nobody awaits (ADR 0021): with the store
// async, a write left un-awaited compiles and races, and `if (getX())` is
// always true. `npm run lint:async`.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.ts", "scripts/**/*.{ts,mts}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreVoid: true,
          // node:test's test() returns a promise the runner itself awaits.
          allowForKnownSafeCalls: [{ from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] }],
        },
      ],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/await-thenable": "error",
    },
  },
];
