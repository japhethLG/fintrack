import { describe, expect, it } from "vitest";
import { firstDayOfLastDays, lastDayOfNextDays } from "@/lib/utils/dateUtils";

/** MANUAL-L4: "next N days" is N calendar days, today included. */
describe("next / last N days windows", () => {
  it("next 30 days from Oct 1 ends Oct 30 (not Oct 31)", () => {
    expect(lastDayOfNextDays("2026-10-01", 30)).toBe("2026-10-30");
  });

  it("next 1 day is today only", () => {
    expect(lastDayOfNextDays("2026-10-01", 1)).toBe("2026-10-01");
  });

  it("crosses a month and a year boundary", () => {
    expect(lastDayOfNextDays("2026-12-20", 14)).toBe("2027-01-02");
    expect(lastDayOfNextDays("2028-02-20", 10)).toBe("2028-02-29");
  });

  it("last 30 days ending Oct 30 starts Oct 1", () => {
    expect(firstDayOfLastDays("2026-10-30", 30)).toBe("2026-10-01");
    expect(firstDayOfLastDays("2026-10-01", 1)).toBe("2026-10-01");
  });
});
