import { describe, expect, it } from "vitest";
import type { IncomeFrequency } from "@/lib/types";
import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { makeOccurrenceParams } from "../../helpers/builders";
import { d, duplicates, ymd, ymdAll } from "../../helpers/dates";

/**
 * The safety limits and the unhandled-input path of the occurrence expander.
 *
 * The eight frequency branches themselves are covered in
 * occurrenceCalculator.shortCycles.test.ts and .longCycles.test.ts. This file
 * covers what those two do not: the MAX_OCCURRENCES ceiling on the branches they
 * did not exercise, the guard nested inside the semi-monthly forEach, and the
 * absent `default` case of the switch.
 */

const MAX_OCCURRENCES = 500;

// ============================================================================
// The 500-occurrence ceiling
// ============================================================================

describe("calculateOccurrences: the MAX_OCCURRENCES ceiling", () => {
  it("truncates a weekly schedule at 500 occurrences", () => {
    // 500 weeks is ~9.6 years; the window is 20 years, so the cap binds.
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "weekly",
        startDate: "2026-01-01",
        scheduleConfig: { dayOfWeek: 4 },
      }),
      d("2026-01-01"),
      d("2046-01-01")
    );

    expect(occurrences).toHaveLength(MAX_OCCURRENCES);
    // Silent truncation: the last date is nowhere near the window end.
    expect(ymd(occurrences[occurrences.length - 1])).toBe("2035-07-26");
    expect(occurrences[occurrences.length - 1].getTime()).toBeLessThan(d("2046-01-01").getTime());
  });

  it("truncates a weekly interval of one week in the bi-weekly branch", () => {
    // intervalWeeks: 1 makes the "bi-weekly" branch step every 7 days, so it can
    // reach the ceiling within a decade.
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "bi-weekly",
        startDate: "2026-01-01",
        scheduleConfig: { intervalWeeks: 1 },
      }),
      d("2026-01-01"),
      d("2046-01-01")
    );

    expect(occurrences).toHaveLength(MAX_OCCURRENCES);
  });

  it("does not truncate a bi-weekly schedule over a decade, since 261 fit", () => {
    // 10 years of fortnightly pay is 261 occurrences — comfortably under the
    // ceiling. Asserted so the cap is known NOT to bind for a realistic window.
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "bi-weekly",
        startDate: "2026-01-01",
        scheduleConfig: { intervalWeeks: 2 },
      }),
      d("2026-01-01"),
      d("2036-01-01")
    );

    expect(occurrences.length).toBeLessThan(MAX_OCCURRENCES);
    expect(occurrences).toHaveLength(261);
  });

  /**
   * Monthly, quarterly and yearly cannot reach 500 within any window a user
   * could plausibly produce: 500 months is 41 years, 500 quarters is 125 years,
   * and 500 years needs a five-century window. The ceiling is therefore
   * unreachable in practice for these three, and a test forcing it would only
   * assert an absurd range. Their non-truncation over a long-but-real window is
   * pinned instead.
   */
  it("leaves monthly, quarterly and yearly under the ceiling for a decade-long window", () => {
    const decade = { start: d("2026-01-01"), end: d("2036-01-01") };
    const counts = (["monthly", "quarterly", "yearly"] as const).map(
      (frequency) =>
        calculateOccurrences(
          makeOccurrenceParams({
            frequency,
            startDate: "2026-01-15",
            scheduleConfig: { dayOfMonth: 15, monthOfYear: 0 },
          }),
          decade.start,
          decade.end
        ).length
    );

    // 120 months, 40 quarters and 10 years: the window end (2036-01-01) falls
    // before that year's occurrence on the 15th, so each count is one short of
    // the round number.
    expect(counts).toEqual([120, 40, 10]);
    counts.forEach((count) => expect(count).toBeLessThan(MAX_OCCURRENCES));
  });

  it("stops a daily schedule at the ceiling", () => {
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({ frequency: "daily", startDate: "2026-01-01" }),
      d("2026-01-01"),
      d("2030-01-01")
    );

    expect(occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(ymd(occurrences[0])).toBe("2026-01-01");
    expect(ymd(occurrences[MAX_OCCURRENCES - 1])).toBe("2027-05-15");
  });
});

// ============================================================================
// The guard nested inside the semi-monthly forEach
// ============================================================================

describe("calculateOccurrences: the semi-monthly inner ceiling guard", () => {
  /**
   * occurrenceCalculator.ts:116 is a second cap check INSIDE the per-month
   * forEach over specificDays. It only fires when the limit is reached partway
   * through a month rather than between months, which needs a specificDays list
   * long enough that the 500th occurrence lands mid-month.
   *
   * With 8 days per month, 500 = 62 months x 8 + 4, so the ceiling is hit on the
   * 5th day of the 63rd month and the remaining 3 days of that month are
   * dropped.
   */
  it("stops partway through a month once the ceiling is reached", () => {
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "semi-monthly",
        startDate: "2026-01-01",
        scheduleConfig: { specificDays: [1, 5, 9, 13, 17, 21, 25, 28] },
      }),
      d("2026-01-01"),
      d("2040-01-01")
    );

    expect(occurrences).toHaveLength(MAX_OCCURRENCES);

    // 62 whole months (Jan 2026 .. Feb 2031) then 4 days of the 63rd (Mar 2031).
    const last = occurrences[occurrences.length - 1];
    expect(ymd(last)).toBe("2031-03-13");

    // The month was abandoned mid-list: the 17th, 21st, 25th and 28th of that
    // same month are absent even though they precede the window end.
    const marchDates = ymdAll(occurrences).filter((date) => date.startsWith("2031-03"));
    expect(marchDates).toEqual(["2031-03-01", "2031-03-05", "2031-03-09", "2031-03-13"]);
  });

  it("emits no duplicates when the inner guard trips", () => {
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "semi-monthly",
        startDate: "2026-01-01",
        scheduleConfig: { specificDays: [1, 5, 9, 13, 17, 21, 25, 28] },
      }),
      d("2026-01-01"),
      d("2040-01-01")
    );

    expect(duplicates(ymdAll(occurrences))).toEqual([]);
  });
});

// ============================================================================
// Unrecognised frequency
// ============================================================================

describe("calculateOccurrences: unrecognised frequency", () => {
  it("returns an empty array rather than throwing", () => {
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: "fortnightly" as unknown as IncomeFrequency,
        startDate: "2026-01-01",
      }),
      d("2026-01-01"),
      d("2026-12-31")
    );

    expect(occurrences).toEqual([]);
  });

  it("returns an empty array for an undefined frequency", () => {
    const occurrences = calculateOccurrences(
      makeOccurrenceParams({
        frequency: undefined as unknown as IncomeFrequency,
        startDate: "2026-01-01",
      }),
      d("2026-01-01"),
      d("2026-12-31")
    );

    expect(occurrences).toEqual([]);
  });

  describe("known defects", () => {
    /**
     * DEFECT: the switch has no `default` case, so an unrecognised frequency
     * falls through and yields no occurrences — silently.
     *
     * Consequence: a rule whose `frequency` is misspelt, or written by an older
     * app version, or corrupted in Firestore, vanishes from every projection
     * with no error anywhere. The user's salary simply stops appearing on the
     * calendar and in every balance, runway and coverage figure derived from it.
     * An empty result is indistinguishable from "this rule has no occurrences in
     * this window", which is a legitimate outcome — so nothing downstream can
     * detect the difference either.
     *
     * CORRECT: an unrecognised frequency is a programming or data error and must
     * surface, not be swallowed. Throwing is the minimum; the value should
     * appear in the message so the bad data can be found.
     */
    it.fails("KNOWN DEFECT: swallows an unrecognised frequency instead of surfacing it", () => {
      expect(() =>
        calculateOccurrences(
          makeOccurrenceParams({
            frequency: "fortnightly" as unknown as IncomeFrequency,
            startDate: "2026-01-01",
          }),
          d("2026-01-01"),
          d("2026-12-31")
        )
      ).toThrow(/fortnightly/);
    });
  });
});
