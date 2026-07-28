import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit/integration test config for the financial projection engine.
 *
 * TZ is pinned to UTC so date-boundary assertions are reproducible.
 * A second config (vitest.config.tz.ts) re-runs the timezone-sensitive
 * suites under a positive UTC offset to catch UTC-parsing regressions.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/timezone/**"],
    setupFiles: ["tests/setup.ts"],
    env: {
      TZ: "UTC",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: [
        "app/lib/logic/**/*.ts",
        "app/lib/utils/dateUtils.ts",
        "app/lib/utils/frequencyUtils.ts",
        "app/lib/firebase/firestore/**/*.ts",
        "app/contexts/FinancialContext/utils/**/*.ts",
        "app/contexts/FinancialContext/actions/transactionActions.ts",
      ],
      exclude: ["**/index.ts", "**/types.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
