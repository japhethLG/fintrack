import { defineConfig, devices } from "@playwright/test";

/**
 * FinTrack E2E. Everything runs against a FINTRACK_E2E=1 static export served on
 * 127.0.0.1 — Firebase/Gemini/ImgBB are replaced by in-browser fakes at build
 * time (see next.config.js and e2e/README.md). No real backend is ever contacted.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const flip = process.env.E2E_FLIP_KNOWN_DEFECTS === "1";

/** One project per timezone: the same specs must hold in all of them. */
const timezones = [
  { name: "UTC", timezoneId: "UTC" },
  { name: "Asia/Manila", timezoneId: "Asia/Manila" }, // +08:00, no DST
  { name: "America/New_York", timezoneId: "America/New_York" }, // -05:00 / -04:00 (DST)
];

export default defineConfig({
  testDir: "./e2e/specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // we want to SEE flakiness, not hide it
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ...(flip ? ([["./e2e/reporters/knownDefects.ts"]] as const) : []),
  ],
  use: {
    baseURL: ORIGIN, // un-prefixed paths are redirected to /fintrack by the e2e server
    locale: "en-US",
    viewport: { width: 1440, height: 900 }, // >= lg breakpoint: desktop sidebar layout
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    serviceWorkers: "block",
  },
  projects: timezones.map(({ name, timezoneId }) => ({
    name,
    use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, timezoneId },
  })),
  webServer: {
    // Builds .next-e2e if sources changed, then serves it. See e2e/scripts/serve.mjs.
    command: "node e2e/scripts/serve.mjs",
    // Our own health endpoint: a foreign server on the port (say a real `next
    // start`) must never be silently reused.
    url: `${ORIGIN}/__e2e_health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000, // first run includes the build
    stdout: "pipe",
    stderr: "pipe",
    env: { E2E_PORT: String(PORT), FINTRACK_E2E: "1", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
