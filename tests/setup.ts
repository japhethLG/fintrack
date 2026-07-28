import { afterEach, vi } from "vitest";

/**
 * Global test setup.
 *
 * - Restores real timers after every test so a frozen clock cannot leak
 *   into an unrelated suite (many calculators call `new Date()` internally).
 * - Clears mock call history between tests.
 */
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
