import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Workspaces drop their tests here; C (contracts/auth) and D (web) own theirs.
    include: [
      "apps/web/src/**/*.{test,spec}.{ts,tsx}",
      "packages/contracts/src/**/*.{test,spec}.ts",
    ],
    // CI runs vitest before any tests exist; keep the pipeline green meanwhile.
    passWithNoTests: true,
  },
});
