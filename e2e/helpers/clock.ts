/**
 * Time control. The app computes "today" from `new Date()` in many places, so
 * every spec runs with a frozen browser clock.
 *
 * FIXED_NOW = 2026-03-10T12:00:00Z (a Tuesday). Chosen because noon UTC lands
 * on the SAME calendar date (2026-03-10) in every project timezone:
 *   UTC 12:00, Asia/Manila (+8) 20:00, America/New_York 08:00 (EDT, -4 — US DST
 *   began Sun 2026-03-08, so on this date New York is already -4, not -5).
 * That lets a spec written for "today is 2026-03-10" pass under all projects.
 * To probe day-rollover behaviour pass a different instant, e.g.
 * `freezeClock(page, "2026-03-10T23:30:00Z")` (already 03-11 in Manila).
 */
import type { Page } from "@playwright/test";

export const FIXED_NOW = "2026-03-10T12:00:00.000Z";
/** Calendar date of FIXED_NOW in every project timezone. */
export const FIXED_TODAY = "2026-03-10";

/**
 * Freeze `Date` (Date.now / new Date()) at `at`; timers keep running normally.
 * Must be called BEFORE the first navigation of the page/context. The fixtures
 * in ../fixtures.ts already do this for you (see the `now` option).
 */
export const freezeClock = async (page: Page, at: string | number | Date = FIXED_NOW): Promise<void> => {
  await page.clock.setFixedTime(at instanceof Date ? at : new Date(at));
};
