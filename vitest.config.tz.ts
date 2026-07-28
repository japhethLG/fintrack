import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Timezone regression config.
 *
 * Runs the tests under tests/timezone/ in Asia/Manila (UTC+8, no DST).
 * Several engine helpers parse "YYYY-MM-DD" with `new Date(str)` (UTC midnight)
 * or serialize with `toISOString()`, both of which shift the calendar day away
 * from UTC. These suites pin that behaviour so it cannot regress silently.
 *
 * Run with: npm run test:tz
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/timezone/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    env: {
      TZ: "Asia/Manila",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
