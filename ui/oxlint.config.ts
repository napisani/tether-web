import { defineConfig } from "oxlint";

const antiSlopRules = {
  "anti-slop/no-array-filter-map": "error",
  "anti-slop/no-reduce-accumulator-copy": "error",
  "anti-slop/no-chained-type-assertions": "error",
  "anti-slop/no-conditional-empty-object-spread": "error",
  "anti-slop/no-known-value-widening": "error",
  "anti-slop/no-module-mocking": "error",
  "anti-slop/no-object-parameters": "error",
  "anti-slop/no-reflect-apply": "error",
  "anti-slop/no-reflect-get": "error",
  "anti-slop/no-runtime-typeof": "error",
  "anti-slop/no-shape-in-symbol-names": "error",
  "anti-slop/no-unknown-parameters": "error",
  "anti-slop/no-unknown-returns": "error",
  "anti-slop/no-unknown-type-aliases": "error",
  "anti-slop/no-unsafe-dictionary-type": "error",
  "anti-slop/no-widen-then-assert": "error",
  "anti-slop/require-readable-spacing": "error",
  "anti-slop/require-safety-comment-for-type-assertion": "error",
} as const;

export default defineConfig({
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "test-results/**",
    "playwright-report/**",
    "tools/oxlint/anti-slop/**",
  ],
  // Explicit plugin lists replace Oxlint's native defaults.
  plugins: ["eslint", "typescript", "unicorn", "oxc", "react", "jsx-a11y", "vitest", "import"],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "eslint-js", specifier: "oxlint-plugin-eslint" },
  ],
  rules: {
    // Oxlint has no native max-len rule; enforce a hard limit through the JS plugin.
    "eslint-js/max-len": ["error", { code: 100, comments: 100 }],
    "import/no-cycle": "error",
    // Existing live regions and the focus-managed dialog intentionally use explicit roles;
    // output/dialog/img/fieldset are not equivalent drop-in replacements here.
    "jsx-a11y/prefer-tag-over-role": "off",
    "oxc/no-accumulating-spread": "error",
    "react/exhaustive-deps": "error",
    "react/only-export-components": ["error", { allowConstantExport: true }],
    "react/rules-of-hooks": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/no-floating-promises": "error",
    "vitest/no-focused-tests": "error",
    "vitest/valid-expect": "error",
    // Modified McCabe complexity avoids charging dispatch switches for every case.
    complexity: ["error", { max: 20, variant: "modified" }],
    ...antiSlopRules,
  },
  overrides: [
    {
      // This focus-managed dialog handles Escape and Tab on its role=dialog section.
      files: ["src/views/devices/ModalDialog.tsx"],
      rules: { "jsx-a11y/no-noninteractive-element-interactions": "off" },
    },
    {
      // Tests validate the JSON body shape at their fetch boundary.
      files: ["src/test-helpers.ts"],
      rules: { "anti-slop/no-runtime-typeof": "off" },
    },
    {
      // These modules are the deliberate untrusted-input parsing seams. Their
      // typeof checks and unknown dictionaries are the validation, not a
      // substitute for it.
      files: [
        "src/daemon/DaemonClient.ts",
        "src/views/devices/devicesState.ts",
        "e2e/fake-tetherd.mjs",
      ],
      rules: {
        "anti-slop/no-runtime-typeof": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      // Catch bindings are runtime errors, not public function contracts.
      files: ["src/views/devices/*Commands.ts"],
      rules: { "anti-slop/no-unknown-parameters": "off" },
    },
    {
      // Tests intentionally use small transport fixtures and controlled casts.
      files: ["**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
    {
      // The protocol wire type is intentionally an open JSON record; every
      // event is narrowed by the daemon parser before feature reducers consume it.
      files: ["src/protocol.ts"],
      rules: { "anti-slop/no-unsafe-dictionary-type": "off" },
    },
  ],
});
