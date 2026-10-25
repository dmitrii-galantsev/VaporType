import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "out/", ".steamui/", "node_modules/", "keyboard/data/words.js", "keyboard/data/lm.js"],
  },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { args: "after-used", argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["keyboard/src/*.js", "keyboard/sim/boot.js", "keyboard/sim/mock.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly", SteamClient: "readonly" },
    },
  },
  {
    files: ["**/*.mjs", "eslint.config.js", "rollup.config.js", "test/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser, SteamClient: "readonly" },
    },
  },
  {
    files: ["test/plugin-sim.mjs"],
    languageOptions: { globals: { VaporType: "readonly" } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
);
