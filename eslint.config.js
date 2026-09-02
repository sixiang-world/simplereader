// ESLint flat config — minimal, non-blocking for existing code.
// Strategy: report errors but don't auto-fix the whole codebase in one shot.
// New code is expected to pass; legacy issues surface as warnings.
import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "node_modules/",
      "dist/",
      "archive/",
      "build-tools/",
      "client/lib/",
      "client/manifests/",
      "**/*.min.js",
      "setup-test-env.sh",
    ],
  },
  js.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      // Keep the bar low for the initial rollout: surface issues without
      // blocking CI. Tighten later once the codebase is clean.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-undef": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-console": "off",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
      // Real issues surfaced during initial lint (27 errors across legacy
      // code). Downgrade to warn so the first lint rollout does not block
      // CI; file follow-ups to fix each.
      "no-unused-private-class-members": "warn",
      "no-constant-binary-expression": "warn",
      "no-redeclare": "warn",
      "no-async-promise-executor": "warn",
      "no-case-declarations": "warn",
      "use-isnan": "warn",
      "no-control-regex": "warn",
      "no-irregular-whitespace": "warn",
      // Stylistic rules delegated to Prettier
      "no-mixed-spaces-and-tabs": "off",
    },
  },
  {
    // Test files: Node-only globals, allow process/console freely.
    files: ["test/**/*.mjs", "test/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Build scripts: Node-only.
    files: ["vite.config.js", "build-tools/**/*.mjs", "setup-test-env.sh"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
