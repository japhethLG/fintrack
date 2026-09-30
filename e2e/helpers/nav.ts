/**
 * The shipped app is a static export under basePath /fintrack (NODE_ENV=production).
 * The e2e server redirects un-prefixed paths, so `page.goto("/dashboard")` works,
 * but URL *assertions* see the prefixed URL — use these helpers for those.
 */
import { expect, type Page } from "@playwright/test";

export const BASE_PATH = "/fintrack";

/** "/login" -> "/fintrack/login" */
export const appPath = (path: string): string => `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;

/** Pathname of the page's current URL without the basePath ("/dashboard"). */
export const currentAppPath = (page: Page): string => {
  const p = new URL(page.url()).pathname;
  return p.startsWith(BASE_PATH) ? p.slice(BASE_PATH.length) || "/" : p;
};

/** Assert the page ends up at an app route, e.g. `await expectAppPath(page, "/login")`. */
export const expectAppPath = async (page: Page, path: string): Promise<void> => {
  await expect.poll(() => currentAppPath(page), { message: `expected app path ${path}` }).toBe(path);
};

/**
 * Wait until the fake Firebase layer is loaded. Also the assertion that the real
 * SDK is not in use. Throws with a loud message otherwise.
 */
export const assertFakeFirebase = async (page: Page): Promise<void> => {
  try {
    await page.waitForFunction(
      () => (window as unknown as { __FINTRACK_FAKE_FIREBASE__?: boolean }).__FINTRACK_FAKE_FIREBASE__ === true,
      undefined,
      { timeout: 15_000 }
    );
  } catch {
    throw new Error(
      "window.__FINTRACK_FAKE_FIREBASE__ is not true: the app is NOT running against the fake Firebase " +
        "layer. Refusing to continue — is the server serving a FINTRACK_E2E=1 build?"
    );
  }
};

/** page.goto + assert the fakes are active. */
export const gotoApp = async (page: Page, path = "/"): Promise<void> => {
  await page.goto(path);
  await assertFakeFirebase(page);
};
