import { vi } from "vitest";

/**
 * Deterministic-clock helpers.
 *
 * A large part of the engine reads "today" from `new Date()` (bill coverage,
 * runway, health score, forecast). These helpers pin it so those functions are
 * testable. `tests/setup.ts` restores real timers after every test.
 */

/**
 * Freeze the clock at local midnight of the given calendar day.
 *
 * Only `Date` is faked — timers/intervals are left alone so nothing hangs.
 *
 * @param ymd - Calendar day as "YYYY-MM-DD"
 */
export const freezeToday = (ymd: string): void => {
  const [y, m, d] = ymd.split("-").map(Number);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(y, m - 1, d, 0, 0, 0, 0) });
};

/**
 * Freeze the clock at a precise local wall-clock instant.
 *
 * Use when the time-of-day matters (e.g. asserting that a calculation which
 * calls `new Date()` mid-day still lands on the right calendar day).
 */
export const freezeAt = (
  ymd: string,
  hours: number,
  minutes = 0,
  seconds = 0
): void => {
  const [y, m, d] = ymd.split("-").map(Number);
  vi.useFakeTimers({
    toFake: ["Date"],
    now: new Date(y, m - 1, d, hours, minutes, seconds, 0),
  });
};

/** Release the frozen clock early (setup.ts also does this after each test). */
export const unfreeze = (): void => {
  vi.useRealTimers();
};
