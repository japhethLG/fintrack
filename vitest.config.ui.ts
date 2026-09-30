import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Component / context / hook integration config (jsdom).
 *
 * Renders the REAL providers and pages against the in-memory Firestore
 * (tests/helpers/firestoreEmulator.ts). See tests/ui/README.md.
 *
 * TZ handling: the timezone defaults to UTC so date-boundary assertions are
 * reproducible. Override with the UI_TEST_TZ environment variable, e.g.
 *
 *   UI_TEST_TZ=Asia/Manila npm run test:ui
 *   npm run test:ui:tz            # shorthand for the line above
 *
 * (Vitest `test.env` cannot be set after the process starts, and Node reads TZ
 * once at startup, so the value is resolved here, in the parent process, and
 * exported to `process.env.TZ` before the workers are forked.)
 */
const TZ = process.env.UI_TEST_TZ || "UTC";
process.env.TZ = TZ;

export default defineConfig({
  // The React 19 automatic JSX runtime is used by the app (tsconfig "jsx": "react-jsx").
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    environmentOptions: {
      // Some components read window.location.origin (apiKeyService).
      jsdom: { url: "http://localhost:3000/" },
    },
    globals: false,
    include: ["tests/ui/**/*.test.tsx"],
    setupFiles: ["tests/ui/setup.ts"],
    env: { TZ },
    // Rendering the whole app is heavier than the logic suites.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    css: false,
    // antd / radix ship ESM that vite-node must inline to resolve correctly.
    server: { deps: { inline: [/antd/, /@ant-design/, /rc-/, /@rc-component/] } },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "app"),
    },
  },
});
