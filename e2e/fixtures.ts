/**
 * THE `test` / `expect` every spec must import (never from "@playwright/test"
 * directly) — it adds, automatically, for every test:
 *
 *  1. NETWORK GUARD: every request whose host is not localhost / 127.0.0.1 /
 *     [::1] is aborted and recorded; the test FAILS in teardown if any was
 *     attempted (the list is in the failure message). There is no real
 *     backend to reach — a request leaving the box means the fakes are not
 *     wired up, or the app has a new external dependency.
 *       - Google Fonts CSS (globals.css @import) is answered with an empty
 *         stylesheet and listed in `toleratedRequests` (not a failure).
 *       - `allowedExternalHosts` lets a spec accept (still ABORT) specific hosts.
 *  2. FAKE-FIREBASE ASSERTION: after any navigation into the app,
 *     window.__FINTRACK_FAKE_FIREBASE__ must be true, else teardown fails.
 *  3. FROZEN CLOCK: Date is frozen at `now` (default 2026-03-10T12:00:00Z).
 *  4. DIAGNOSTICS: uncaught page errors and console errors are collected
 *     (`diagnostics`) and attached to the report when non-empty.
 *
 * Timezone is a Playwright *project* setting (see playwright.config.ts).
 */
import { expect as baseExpect, test as base, type Page } from "@playwright/test";
import { FIXED_NOW } from "./helpers/clock";

export interface RecordedRequest {
  method: string;
  url: string;
  resourceType: string;
  /** URL of the page/frame that issued it. */
  from: string;
}

export interface Diagnostics {
  /** Uncaught exceptions in the page (window.onerror / unhandledrejection). */
  pageErrors: string[];
  /** console.error() messages. */
  consoleErrors: string[];
  /** console.warn() messages. */
  consoleWarnings: string[];
}

interface Options {
  /** Instant the browser clock is frozen at. */
  now: string | number | Date;
  /** External hosts that are aborted but do not fail the test. Discouraged. */
  allowedExternalHosts: string[];
}

interface Fixtures {
  /** External (non-local) requests that were attempted and aborted. */
  externalRequests: RecordedRequest[];
  /** Known-benign external requests we answered with a stub (fonts CSS). */
  toleratedRequests: RecordedRequest[];
  diagnostics: Diagnostics;
  /** Auto fixture: guard + clock + fake assertion. Don't use directly. */
  harness: void;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLocal = (url: URL): boolean => LOCAL_HOSTS.has(url.hostname) || url.protocol === "data:" || url.protocol === "blob:";

/** Hosts we do not let through but answer with a harmless stub instead. */
const STUBBED: Record<string, { contentType: string; body: string }> = {
  "fonts.googleapis.com": { contentType: "text/css", body: "/* e2e: google fonts stubbed */" },
};

const APP_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/fintrack(\/|$)/;

const fakeFlag = (page: Page): Promise<boolean | "no-app"> => {
  if (!APP_ORIGIN_RE.test(page.url())) return Promise.resolve("no-app");
  return page
    .evaluate(() => (window as unknown as { __FINTRACK_FAKE_FIREBASE__?: boolean }).__FINTRACK_FAKE_FIREBASE__ === true)
    .catch(() => "no-app" as const);
};

export const test = base.extend<Fixtures & Options>({
  now: [FIXED_NOW, { option: true }],
  allowedExternalHosts: [[], { option: true }],

  externalRequests: async ({}, use) => {
    await use([]);
  },
  toleratedRequests: async ({}, use) => {
    await use([]);
  },
  diagnostics: async ({}, use) => {
    await use({ pageErrors: [], consoleErrors: [], consoleWarnings: [] });
  },

  harness: [
    async ({ context, page, now, allowedExternalHosts, externalRequests, toleratedRequests, diagnostics }, use, testInfo) => {
      // --- clock -----------------------------------------------------------
      await context.clock.setFixedTime(now instanceof Date ? now : new Date(now));

      // --- network guard ---------------------------------------------------
      await context.route(
        (url) => !isLocal(url),
        async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const rec: RecordedRequest = {
            method: request.method(),
            url: request.url(),
            resourceType: request.resourceType(),
            from: request.frame()?.url() ?? "",
          };
          const stub = STUBBED[url.hostname];
          if (stub) {
            toleratedRequests.push(rec);
            await route.fulfill({ status: 200, contentType: stub.contentType, body: stub.body });
            return;
          }
          if (!allowedExternalHosts.includes(url.hostname)) externalRequests.push(rec);
          await route.abort("blockedbyclient");
        }
      );
      // WebSockets (firestore long-polling/auth use them if a real SDK sneaks in)
      await context.routeWebSocket(
        (url) => !isLocal(url),
        (ws) => {
          const url = new URL(ws.url());
          if (!allowedExternalHosts.includes(url.hostname)) {
            externalRequests.push({ method: "WS", url: ws.url(), resourceType: "websocket", from: page.url() });
          }
          void ws.close({ code: 1008, reason: "blocked by e2e network guard" });
        }
      );

      // --- diagnostics -----------------------------------------------------
      page.on("pageerror", (err) => diagnostics.pageErrors.push(`${err.name}: ${err.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error") diagnostics.consoleErrors.push(msg.text());
        else if (msg.type() === "warning") diagnostics.consoleWarnings.push(msg.text());
      });

      await use();

      // --- teardown assertions --------------------------------------------
      const problems: string[] = [];

      for (const p of context.pages()) {
        const flag = await fakeFlag(p);
        if (flag === false) {
          problems.push(
            `window.__FINTRACK_FAKE_FIREBASE__ is not true on ${p.url()} — the REAL Firebase SDK may be in use. ` +
              "Is the server serving a FINTRACK_E2E=1 build?"
          );
        }
      }

      if (externalRequests.length > 0) {
        problems.push(
          `${externalRequests.length} external network request(s) were attempted (and aborted):\n` +
            externalRequests.map((r) => `  ${r.method} ${r.url} [${r.resourceType}] from ${r.from}`).join("\n")
        );
      }

      const attach = async (name: string, lines: string[]) => {
        if (lines.length > 0) await testInfo.attach(name, { body: lines.join("\n"), contentType: "text/plain" });
      };
      await attach("page-errors.txt", diagnostics.pageErrors);
      await attach("console-errors.txt", diagnostics.consoleErrors);
      await attach("tolerated-external-requests.txt", toleratedRequests.map((r) => `${r.method} ${r.url}`));

      if (problems.length > 0) throw new Error(`E2E harness guard failed:\n${problems.join("\n")}`);
    },
    { auto: true },
  ],
});

export const expect = baseExpect;
export type { Page };
