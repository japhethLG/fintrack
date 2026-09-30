/**
 * Global setup for the UI (jsdom) suite. Runs before every test file.
 *
 * `vi.mock` calls placed in a setup file apply to every test file, so no spec
 * needs mock boilerplate. Everything that could touch a backend is replaced
 * here, BEFORE any app module is imported:
 *
 *   firebase/firestore          -> tests/helpers/firestoreEmulator (in-memory)
 *   firebase/auth               -> harness/authFake
 *   @/lib/firebase/config       -> harness/configMock (real config never runs)
 *   geminiService/imageBBService-> harness/serviceMocks
 *   next/navigation|image|link  -> harness/router, harness/nextMocks
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

import { installBrowserShims } from "./harness/browserShims";
import { blockedRequests, installNetworkGuard } from "./harness/networkGuard";
import { __resetRouter } from "./harness/router";
import * as authFake from "./harness/authFake";
import * as store from "../helpers/firestoreEmulator";
import { resetConsoleCapture, assertNoUnexpectedConsole } from "./harness/consoleCapture";

// ---------------------------------------------------------------------------
// Module mocks (hoisted above the imports by vitest)
// ---------------------------------------------------------------------------
vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("firebase/auth", () => import("./harness/authFake"));
vi.mock("@/lib/firebase/config", () => import("./harness/configMock"));
vi.mock(
  "@/lib/services/geminiService",
  async () => (await import("./harness/serviceMocks")).geminiServiceMock
);
vi.mock(
  "@/lib/services/imageBBService",
  async () => (await import("./harness/serviceMocks")).imageBBServiceMock
);
vi.mock("next/navigation", () => import("./harness/router"));
vi.mock("next/image", async () => ({ default: (await import("./harness/nextMocks")).NextImage }));
vi.mock("next/link", async () => ({ default: (await import("./harness/nextMocks")).NextLink }));

// ---------------------------------------------------------------------------
// Environment hardening
// ---------------------------------------------------------------------------

// Belt and braces: no Firebase / API keys can leak into the process env.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("NEXT_PUBLIC_")) delete process.env[key];
}

installBrowserShims();
installNetworkGuard();

/**
 * React Testing Library / DTL only take their fake-timer code path when a
 * `jest` global with `advanceTimersByTime` exists. Providing it makes
 * `waitFor` / `findBy*` advance vitest's fake clock deterministically instead
 * of depending on real elapsed time. See tests/ui/README.md ("Timers").
 */
(globalThis as Record<string, unknown>).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
};

// waitFor/findBy timeouts are measured on the FAKE clock (see README "Timers"),
// so give them more fake milliseconds than the 1000 default: each polling loop
// only advances 50 ms.
configure({ asyncUtilTimeout: 3000 });

// Tell React 19 this is an act() environment (RTL also sets it per render).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIGURED_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = CONFIGURED_TZ; // undo a previous test's renderApp({ timeZone })
  store.__reset();
  authFake.__reset();
  __resetRouter();
  blockedRequests.length = 0;
  resetConsoleCapture();
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
});

afterEach(() => {
  // Unmount first so provider effects/unsubscribes run under the fake clock.
  cleanup();
  // Libraries (recharts' text-measurement span, radix scroll lock) leave
  // nodes/attributes on <body> that RTL's unmount cannot see. Wipe them so one
  // test's DOM can never satisfy another test's query.
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.body.removeAttribute("data-scroll-locked");
  process.env.TZ = CONFIGURED_TZ;
  vi.useRealTimers();
  vi.clearAllMocks();
  // A blocked request is always a bug in the test or the app — surface it
  // even if the app swallowed the rejection.
  if (blockedRequests.length > 0) {
    const attempts = blockedRequests.map((r) => `${r.kind} ${r.target}`).join(", ");
    blockedRequests.length = 0;
    throw new Error(`Network access was attempted and blocked: ${attempts}`);
  }
  assertNoUnexpectedConsole();
});
