/**
 * calculateOccurrences — long-cycle frequencies ("semi-monthly", "monthly",
 * "quarterly", "yearly").
 *
 * All expected arrays are written out in full: whole-array equality catches a
 * wrong date AND a wrong count, which length-only assertions miss.
 *
 * Dates are built/formatted with the raw-Date helpers in tests/helpers/dates so
 * the engine's dayjs helpers are never used to validate the engine's own date
 * handling.
 */

import { describe, expect, it } from "vitest";
import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { d, weekday, ymdAll } from "../../helpers/dates";

/**
 * Local helper: `calculateOccurrences` takes a bare OccurrenceParams object
 * (not an IncomeSource), so none of the shared builders fit. This wrapper keeps
 * each test to its meaningful inputs and returns "YYYY-MM-DD" strings.
 */
const occurrences = (
  params: {
    frequency: IncomeFrequency;
    startDate: string;
    endDate?: string;
    scheduleConfig?: ScheduleConfig;
    weekendAdjustment?: "before" | "after" | "none";
  },
  viewStart: string,
  viewEnd: string
): string[] =>
  ymdAll(
    calculateOccurrences(
      {
        frequency: params.frequency,
        startDate: params.startDate,
        endDate: params.endDate,
        scheduleConfig: params.scheduleConfig ?? {},
        weekendAdjustment: params.weekendAdjustment ?? "none",
      },
      d(viewStart),
      d(viewEnd)
    )
  );

/** scheduleConfig is typed as required, so absence has to be forced. */
const NO_CONFIG = undefined as unknown as ScheduleConfig;

// ============================================================================
// SEMI-MONTHLY
// ============================================================================

describe("calculateOccurrences — semi-monthly", () => {
  describe("specificDays", () => {
    it("defaults to the 15th and the 30th of every month in the window", () => {
      expect(
        occurrences(
          { frequency: "semi-monthly", startDate: "2026-01-01" },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual([
        "2026-01-15",
        "2026-01-30",
        "2026-02-15",
        // February has no 30th in 2026 (non-leap) so day 30 clamps to the 28th
        "2026-02-28",
        "2026-03-15",
        "2026-03-30",
      ]);
    });

    it("honours a custom [1, 16] pair", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [1, 16] },
          },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual(["2026-01-01", "2026-01-16", "2026-02-01", "2026-02-16"]);
    });

    it("honours a custom [10, 25] pair", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [10, 25] },
          },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual(["2026-01-10", "2026-01-25", "2026-02-10", "2026-02-25"]);
    });

    it("fires on every day listed when more than two specificDays are configured", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [5, 15, 25] },
          },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual([
        "2026-01-05",
        "2026-01-15",
        "2026-01-25",
        "2026-02-05",
        "2026-02-15",
        "2026-02-25",
      ]);
    });

    it("fires exactly once per month when a single specificDay is configured", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [15] },
          },
          "2026-01-01",
          "2026-04-30"
        )
      ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
    });

    it("returns dates in ascending order within each month for an ascending specificDays list", () => {
      const result = occurrences(
        {
          frequency: "semi-monthly",
          startDate: "2026-01-01",
          scheduleConfig: { specificDays: [10, 25] },
        },
        "2026-01-01",
        "2026-03-31"
      );
      expect(result).toEqual([...result].sort());
    });

    it("produces the same set of dates regardless of the order of specificDays", () => {
      // The engine iterates specificDays in the order given (a descending list
      // therefore comes back descending within a month), but every consumer
      // re-sorts by date, so only the set of dates is load-bearing here.
      const descending = occurrences(
        {
          frequency: "semi-monthly",
          startDate: "2026-01-01",
          scheduleConfig: { specificDays: [30, 15] },
        },
        "2026-01-01",
        "2026-02-28"
      );
      expect([...descending].sort()).toEqual([
        "2026-01-15",
        "2026-01-30",
        "2026-02-15",
        "2026-02-28",
      ]);
    });
  });

  describe("month-length clamping", () => {
    it("clamps day 31 to the last day of every short month across Jan–Jun 2026", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [31] },
          },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
      ]);
    });

    it("clamps day 31 to February 29 in the leap year 2028", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2028-01-01",
            scheduleConfig: { specificDays: [31] },
          },
          "2028-01-01",
          "2028-03-31"
        )
      ).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    });

    it("clamps day 30 to February 28 in the non-leap year 2026", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-02-01",
            scheduleConfig: { specificDays: [15, 30] },
          },
          "2026-02-01",
          "2026-02-28"
        )
      ).toEqual(["2026-02-15", "2026-02-28"]);
    });
  });

  describe("start date and window boundaries", () => {
    it("excludes occurrences that fall before startDate even when they are inside the view window", () => {
      // The 15th of January is inside the view window but precedes the
      // schedule's own start date of 2026-01-20, so it must not be emitted.
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-20",
            scheduleConfig: { specificDays: [15, 30] },
          },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual(["2026-01-30", "2026-02-15", "2026-02-28"]);
    });

    it("excludes occurrences before viewStartDate", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            scheduleConfig: { specificDays: [15, 30] },
          },
          "2026-02-20",
          "2026-03-31"
        )
      ).toEqual(["2026-02-28", "2026-03-15", "2026-03-30"]);
    });

    it("truncates at endDate when endDate falls before viewEndDate", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-01",
            endDate: "2026-02-20",
            scheduleConfig: { specificDays: [15, 30] },
          },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual(["2026-01-15", "2026-01-30", "2026-02-15"]);
    });

    it("keeps the trailing occurrence when the window ends mid-month", () => {
      // Counterpart to the monthly/quarterly trailing-drop defect: because the
      // semi-monthly cursor is normalised to the 1st of the month, the final
      // partial month is still visited and 2026-03-01 survives.
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-20",
            scheduleConfig: { specificDays: [1, 16] },
          },
          "2026-01-01",
          "2026-03-10"
        )
      ).toEqual(["2026-02-01", "2026-02-16", "2026-03-01"]);
    });

    it("does not skip a month when the schedule starts on the 31st", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-01-31",
            scheduleConfig: { specificDays: [1, 16] },
          },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual(["2026-02-01", "2026-02-16", "2026-03-01", "2026-03-16"]);
    });

    it("returns nothing when startDate is after the whole view window", () => {
      expect(
        occurrences(
          {
            frequency: "semi-monthly",
            startDate: "2026-07-01",
            scheduleConfig: { specificDays: [15, 30] },
          },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual([]);
    });
  });

  describe("safety cap", () => {
    it("stops at the 500-occurrence limit over a 75-year window", () => {
      const result = occurrences(
        { frequency: "semi-monthly", startDate: "2026-01-01" },
        "2026-01-01",
        "2100-12-31"
      );
      // 500 occurrences / 2 per month = 250 months starting January 2026,
      // i.e. through October 2046, whose second payday is the 30th.
      expect(result).toHaveLength(500);
      expect(result[0]).toBe("2026-01-15");
      expect(result[result.length - 1]).toBe("2046-10-30");
    });
  });

  describe("missing scheduleConfig", () => {
    it("does not throw and falls back to the 15th and 30th", () => {
      expect(
        occurrences(
          { frequency: "semi-monthly", startDate: "2026-01-10", scheduleConfig: NO_CONFIG },
          "2026-01-01",
          "2026-02-28"
        )
      ).toEqual(["2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28"]);
    });
  });
});

// ============================================================================
// MONTHLY
// ============================================================================

describe("calculateOccurrences — monthly", () => {
  describe("day selection", () => {
    it("uses dayOfMonth from scheduleConfig", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 15 } },
          "2026-01-01",
          "2026-04-30"
        )
      ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15", "2026-04-15"]);
    });

    it("falls back to the startDate day-of-month when dayOfMonth is absent", () => {
      expect(
        occurrences({ frequency: "monthly", startDate: "2026-03-10" }, "2026-03-01", "2026-06-30")
      ).toEqual(["2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10"]);
    });

    it("does not throw when scheduleConfig is undefined and uses the startDate day", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-10", scheduleConfig: NO_CONFIG },
          "2026-01-01",
          "2026-04-30"
        )
      ).toEqual(["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]);
    });
  });

  describe("month-length clamping", () => {
    it("clamps day 31 to each month's last day across a Jan–Jun window", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-31", scheduleConfig: { dayOfMonth: 31 } },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
      ]);
    });

    it("clamps day 29 to February 28 in the non-leap year 2026", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 29 } },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual(["2026-01-29", "2026-02-28", "2026-03-29"]);
    });

    it("keeps day 29 on February 29 in the leap year 2028", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2028-01-01", scheduleConfig: { dayOfMonth: 29 } },
          "2028-01-01",
          "2028-03-31"
        )
      ).toEqual(["2028-01-29", "2028-02-29", "2028-03-29"]);
    });
  });

  describe("start date and window boundaries", () => {
    it("truncates at endDate when endDate falls before viewEndDate", () => {
      expect(
        occurrences(
          {
            frequency: "monthly",
            startDate: "2026-01-15",
            endDate: "2026-03-20",
            scheduleConfig: { dayOfMonth: 15 },
          },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
    });

    it("emits only dates on or after startDate", () => {
      // The 5th of January precedes the 2026-01-20 start date, so the first
      // emitted occurrence is February's.
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-20", scheduleConfig: { dayOfMonth: 5 } },
          "2026-01-01",
          "2026-03-31"
        )
      ).toEqual(["2026-02-05", "2026-03-05"]);
    });

    it("emits the occurrence that lands exactly on startDate", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-10", scheduleConfig: { dayOfMonth: 10 } },
          "2026-01-01",
          "2026-03-10"
        )
      ).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
    });

    it("excludes occurrences before viewStartDate", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 15 } },
          "2026-03-01",
          "2026-05-31"
        )
      ).toEqual(["2026-03-15", "2026-04-15", "2026-05-15"]);
    });

    it("returns nothing when startDate is after the whole view window", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-07-01", scheduleConfig: { dayOfMonth: 1 } },
          "2026-01-01",
          "2026-06-30"
        )
      ).toEqual([]);
    });
  });

  describe("weekend adjustment", () => {
    // 2026-01-04 is a Sunday and 2026-04-04 is a Saturday; 2026-02-04 and
    // 2026-03-04 are both Wednesdays and must be left untouched.
    it("moves a weekend date back to the preceding Friday with 'before'", () => {
      const result = occurrences(
        {
          frequency: "monthly",
          startDate: "2026-01-01",
          scheduleConfig: { dayOfMonth: 4 },
          weekendAdjustment: "before",
        },
        "2026-01-01",
        "2026-04-30"
      );
      expect(result).toEqual(["2026-01-02", "2026-02-04", "2026-03-04", "2026-04-03"]);
      expect(result.map(weekday)).toEqual(["Fri", "Wed", "Wed", "Fri"]);
    });

    it("moves a weekend date forward to the following Monday with 'after'", () => {
      const result = occurrences(
        {
          frequency: "monthly",
          startDate: "2026-01-01",
          scheduleConfig: { dayOfMonth: 4 },
          weekendAdjustment: "after",
        },
        "2026-01-01",
        "2026-04-30"
      );
      expect(result).toEqual(["2026-01-05", "2026-02-04", "2026-03-04", "2026-04-06"]);
      expect(result.map(weekday)).toEqual(["Mon", "Wed", "Wed", "Mon"]);
    });

    it("leaves weekday dates untouched with 'none'", () => {
      const result = occurrences(
        {
          frequency: "monthly",
          startDate: "2026-01-01",
          scheduleConfig: { dayOfMonth: 4 },
          weekendAdjustment: "none",
        },
        "2026-01-01",
        "2026-04-30"
      );
      expect(result).toEqual(["2026-01-04", "2026-02-04", "2026-03-04", "2026-04-04"]);
      expect(result.map(weekday)).toEqual(["Sun", "Wed", "Wed", "Sat"]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: monthly drops the trailing occurrence.
     * occurrenceCalculator.ts:134 tests `monthCursor`, which carries the START
     * DATE's day-of-month (the 20th), while the emitted date on line 138 is
     * built from `dayOfMonth` (the 1st). When dayOfMonth is earlier in the month
     * than the start day, the cursor for the last period (2026-03-20) is already
     * past the window end (2026-03-15) and the loop exits before emitting
     * 2026-03-01, which is inside the window.
     * Correct behaviour: ["2026-02-01", "2026-03-01"].
     */
    it.fails(
      "KNOWN DEFECT: emits the final occurrence when dayOfMonth precedes the start day",
      () => {
        expect(
          occurrences(
            { frequency: "monthly", startDate: "2026-01-20", scheduleConfig: { dayOfMonth: 1 } },
            "2026-01-01",
            "2026-03-15"
          )
        ).toEqual(["2026-02-01", "2026-03-01"]);
      }
    );

    /**
     * DEFECT (same root cause as above, occurrenceCalculator.ts:134): with
     * startDate 2026-01-25 and dayOfMonth 10, the cursor for April is
     * 2026-04-25 which is past the window end 2026-04-15, so 2026-04-10 is
     * silently dropped even though it precedes the window end by five days.
     * Correct behaviour: ["2026-02-10", "2026-03-10", "2026-04-10"].
     */
    it.fails("KNOWN DEFECT: does not lose a month whose cursor overshoots the window end", () => {
      expect(
        occurrences(
          { frequency: "monthly", startDate: "2026-01-25", scheduleConfig: { dayOfMonth: 10 } },
          "2026-01-01",
          "2026-04-15"
        )
      ).toEqual(["2026-02-10", "2026-03-10", "2026-04-10"]);
    });

    /**
     * DEFECT (additional, found while testing): weekend adjustment is applied
     * AFTER the window/start-date filter (occurrenceCalculator.ts:141-142 calls
     * adjustForWeekend on the already-accepted date), so "before" can shift an
     * occurrence to a day that precedes both startDate and viewStartDate.
     * 2026-02-01 is a Sunday; with adjustment "before" the engine returns
     * 2026-01-30 — two days before the schedule even begins, and outside the
     * requested February window. See also dateUtils.ts:20-33.
     * Correct behaviour: no returned occurrence may precede startDate.
     */
    it.fails(
      "KNOWN DEFECT: never returns a date earlier than startDate after 'before' adjustment",
      () => {
        const result = occurrences(
          {
            frequency: "monthly",
            startDate: "2026-02-01",
            scheduleConfig: { dayOfMonth: 1 },
            weekendAdjustment: "before",
          },
          "2026-02-01",
          "2026-02-28"
        );
        expect(result.every((day) => day >= "2026-02-01")).toBe(true);
      }
    );

    /**
     * DEFECT (additional, found while testing): the mirror image of the case
     * above. 2026-01-31 is a Saturday; with adjustment "after" the engine
     * returns 2026-02-02, which is past the requested window end of
     * 2026-01-31 (occurrenceCalculator.ts:141-142).
     * Correct behaviour: no returned occurrence may fall after the effective
     * end of the window.
     */
    it.fails(
      "KNOWN DEFECT: never returns a date past the window end after 'after' adjustment",
      () => {
        const result = occurrences(
          {
            frequency: "monthly",
            startDate: "2026-01-01",
            scheduleConfig: { dayOfMonth: 31 },
            weekendAdjustment: "after",
          },
          "2026-01-01",
          "2026-01-31"
        );
        expect(result.every((day) => day <= "2026-01-31")).toBe(true);
      }
    );
  });
});

// ============================================================================
// QUARTERLY
// ============================================================================

describe("calculateOccurrences — quarterly", () => {
  it("steps three months at a time from startDate", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-01-15", scheduleConfig: { dayOfMonth: 15 } },
        "2026-01-01",
        "2026-12-31"
      )
    ).toEqual(["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]);
  });

  it("defaults dayOfMonth to 1 rather than falling back to the startDate day", () => {
    // Unlike monthly/yearly, quarterly hardcodes day 1 when dayOfMonth is
    // absent (occurrenceCalculator.ts:151). With startDate 2026-01-15 the first
    // candidate is 2026-01-01, which precedes startDate and is therefore
    // dropped — so the series begins in April, not January, and never lands on
    // the 15th.
    expect(
      occurrences({ frequency: "quarterly", startDate: "2026-01-15" }, "2026-01-01", "2026-12-31")
    ).toEqual(["2026-04-01", "2026-07-01", "2026-10-01"]);
  });

  it("does not throw when scheduleConfig is undefined and still uses day 1", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-01-10", scheduleConfig: NO_CONFIG },
        "2026-01-01",
        "2026-06-30"
      )
    ).toEqual(["2026-04-01"]);
  });

  it("honours a custom dayOfMonth on each quarter month", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 20 } },
        "2026-02-01",
        "2026-12-31"
      )
    ).toEqual(["2026-02-20", "2026-05-20", "2026-08-20", "2026-11-20"]);
  });

  it("clamps day 31 to the last day of each quarter month", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-02-15", scheduleConfig: { dayOfMonth: 31 } },
        "2026-02-01",
        "2027-01-31"
      )
    ).toEqual(["2026-02-28", "2026-05-31", "2026-08-31", "2026-11-30"]);
  });

  it("keeps the quarterly cadence when the start day itself needs clamping", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-01-31", scheduleConfig: { dayOfMonth: 31 } },
        "2026-01-01",
        "2027-02-28"
      )
    ).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
  });

  it("continues across a calendar-year boundary", () => {
    expect(
      occurrences(
        { frequency: "quarterly", startDate: "2026-11-01", scheduleConfig: { dayOfMonth: 1 } },
        "2026-10-01",
        "2027-06-30"
      )
    ).toEqual(["2026-11-01", "2027-02-01", "2027-05-01"]);
  });

  it("truncates at endDate when endDate falls before viewEndDate", () => {
    expect(
      occurrences(
        {
          frequency: "quarterly",
          startDate: "2026-01-15",
          endDate: "2026-08-01",
          scheduleConfig: { dayOfMonth: 15 },
        },
        "2026-01-01",
        "2026-12-31"
      )
    ).toEqual(["2026-01-15", "2026-04-15", "2026-07-15"]);
  });

  describe("known defects", () => {
    /**
     * DEFECT: quarterly drops the trailing occurrence — the same cursor-vs-
     * emitted-day mismatch as monthly. occurrenceCalculator.ts:154 tests
     * `current`, which carries the START DATE's day-of-month (the 25th), while
     * the emitted date on line 158 uses `dayOfMonth` (the 1st). The July cursor
     * is 2026-07-25, past the window end 2026-07-10, so the loop exits before
     * emitting 2026-07-01, which is inside the window.
     * Correct behaviour: ["2026-04-01", "2026-07-01"].
     */
    it.fails("KNOWN DEFECT: emits the final quarter when dayOfMonth precedes the start day", () => {
      expect(
        occurrences(
          { frequency: "quarterly", startDate: "2026-01-25", scheduleConfig: { dayOfMonth: 1 } },
          "2026-01-01",
          "2026-07-10"
        )
      ).toEqual(["2026-04-01", "2026-07-01"]);
    });
  });
});

// ============================================================================
// YEARLY
// ============================================================================

describe("calculateOccurrences — yearly", () => {
  it("uses monthOfYear and dayOfMonth from scheduleConfig across a multi-year window", () => {
    // monthOfYear is zero-based: 6 = July.
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2026-01-01",
          scheduleConfig: { monthOfYear: 6, dayOfMonth: 4 },
        },
        "2026-01-01",
        "2028-12-31"
      )
    ).toEqual(["2026-07-04", "2027-07-04", "2028-07-04"]);
  });

  it("falls back to the startDate month and day when scheduleConfig omits them", () => {
    expect(
      occurrences({ frequency: "yearly", startDate: "2026-03-17" }, "2026-01-01", "2028-12-31")
    ).toEqual(["2026-03-17", "2027-03-17", "2028-03-17"]);
  });

  it("does not throw when scheduleConfig is undefined and uses the startDate anniversary", () => {
    expect(
      occurrences(
        { frequency: "yearly", startDate: "2026-01-10", scheduleConfig: NO_CONFIG },
        "2026-01-01",
        "2027-12-31"
      )
    ).toEqual(["2026-01-10", "2027-01-10"]);
  });

  it("clamps a February 29 anniversary to February 28 in non-leap years", () => {
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2028-01-01",
          scheduleConfig: { monthOfYear: 1, dayOfMonth: 29 },
        },
        "2028-01-01",
        "2030-12-31"
      )
    ).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
  });

  it("yields at most one occurrence for a window shorter than a year", () => {
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2026-01-01",
          scheduleConfig: { monthOfYear: 6, dayOfMonth: 4 },
        },
        "2026-06-01",
        "2026-09-30"
      )
    ).toEqual(["2026-07-04"]);
  });

  it("yields nothing when a sub-year window misses the anniversary", () => {
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2026-01-01",
          scheduleConfig: { monthOfYear: 6, dayOfMonth: 4 },
        },
        "2026-08-01",
        "2026-12-31"
      )
    ).toEqual([]);
  });

  it("truncates at endDate when endDate falls before viewEndDate", () => {
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2026-01-01",
          endDate: "2027-06-01",
          scheduleConfig: { monthOfYear: 6, dayOfMonth: 4 },
        },
        "2026-01-01",
        "2029-12-31"
      )
    ).toEqual(["2026-07-04"]);
  });

  it("keeps the trailing occurrence when the window ends just after the anniversary", () => {
    // Counterpart to the monthly/quarterly trailing-drop defect: yearly
    // iterates an integer year cursor up to effectiveEnd's year, so the final
    // partial year is still visited and 2027-03-01 survives even though it is
    // earlier in the month than the 2026-03-20 start day.
    expect(
      occurrences(
        {
          frequency: "yearly",
          startDate: "2026-03-20",
          scheduleConfig: { monthOfYear: 2, dayOfMonth: 1 },
        },
        "2026-01-01",
        "2027-03-10"
      )
    ).toEqual(["2027-03-01"]);
  });

  describe("known defects", () => {
    /**
     * DEFECT (additional, found while testing): occurrenceCalculator.ts:171
     * resolves the month with `scheduleConfig.monthOfYear || start.getMonth()`.
     * monthOfYear is zero-based, so a configured January (0) is falsy and gets
     * silently replaced by the startDate's month. With startDate 2026-06-15 and
     * monthOfYear 0 / dayOfMonth 10, the engine returns June anniversaries
     * (["2027-06-10", "2028-06-10"]) instead of January ones.
     * Correct behaviour: ["2027-01-10", "2028-01-10"] — 2026-01-10 precedes
     * startDate and is correctly excluded.
     */
    it.fails("KNOWN DEFECT: honours a configured monthOfYear of 0 (January)", () => {
      expect(
        occurrences(
          {
            frequency: "yearly",
            startDate: "2026-06-15",
            scheduleConfig: { monthOfYear: 0, dayOfMonth: 10 },
          },
          "2026-01-01",
          "2028-12-31"
        )
      ).toEqual(["2027-01-10", "2028-01-10"]);
    });
  });
});
