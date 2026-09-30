/**
 * Mark the current test as documenting a KNOWN product defect.
 *
 *   test("weekly income lands on the wrong day in Manila", async ({ page }) => {
 *     knownDefect("D-012", "calendar shows 2026-03-11 instead of 2026-03-10");
 *     ...assert the CORRECT behaviour...
 *   });
 *
 * Write the assertion for what the app SHOULD do. Then:
 *   - normal run: the test is `test.fail()` — it is reported green while the
 *     defect exists, and goes RED ("expected to fail but passed") the moment
 *     someone fixes it, telling you to delete the marker.
 *   - E2E_FLIP_KNOWN_DEFECTS=1: the marker is a no-op (only annotates), so the
 *     test runs as a normal test and must FAIL. The bundled reporter
 *     (e2e/reporters/knownDefects.ts) then classifies each failure as an
 *     assertion mismatch (good) vs timeout/crash (the test is broken, not the
 *     app) — see README "Known defects".
 *
 * Call it as the FIRST statement of the test body.
 */
import { test } from "@playwright/test";

export const FLIP_ENV = "E2E_FLIP_KNOWN_DEFECTS";

export const isFlipMode = (): boolean => process.env[FLIP_ENV] === "1";

export const knownDefect = (id: string, observed: string): void => {
  if (!id || !observed) throw new Error("knownDefect(id, observed) needs both arguments");
  const info = test.info();
  info.annotations.push({ type: "known-defect", description: `${id}: observed ${observed}` });
  if (!isFlipMode()) {
    test.fail(true, `known defect ${id}: ${observed}`);
  }
};
