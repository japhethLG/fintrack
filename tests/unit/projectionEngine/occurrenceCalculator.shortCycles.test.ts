import { describe, it, expect } from "vitest";
import type { IncomeSource } from "@/lib/types";
import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { makeIncomeSource } from "../../helpers/builders";
import { d, ymd, ymdAll, weekday, daysBetween, duplicates } from "../../helpers/dates";

/**
 * `calculateOccurrences` for the short-cycle frequencies: "one-time", "daily",
 * "weekly" and "bi-weekly".
 *
 * All dates are 2026 dates. Reference weekdays used throughout:
 *   2026-01-01 Thu   2026-01-03 Sat   2026-01-04 Sun
 *   2026-02-07 Sat   2026-02-08 Sun   2026-03-01 Sun
 */

type Params = Parameters<typeof calculateOccurrences>[0];

/**
 * Local helper: `calculateOccurrences` takes a bare `OccurrenceParams` struct,
 * which no shared builder produces. This projects the schedule-bearing fields
 * of `makeIncomeSource` onto that struct so the 2026-01-01 / monthly / "none"
 * defaults still come from the shared builder.
 */
const params = (overrides: Partial<IncomeSource> = {}): Params => {
  const source = makeIncomeSource(overrides);
  return {
    frequency: source.frequency,
    startDate: source.startDate,
    endDate: source.endDate,
    scheduleConfig: source.scheduleConfig,
    weekendAdjustment: source.weekendAdjustment,
  };
};

/** Run the calculator over a window expressed as two "YYYY-MM-DD" strings. */
const occ = (overrides: Partial<IncomeSource>, viewStart: string, viewEnd: string): Date[] =>
  calculateOccurrences(params(overrides), d(viewStart), d(viewEnd));

/** Day gaps between consecutive occurrences, in whole days. */
const gaps = (dates: Date[]): number[] =>
  dates
    .slice(1)
    .map((date, i) => Math.round((date.getTime() - dates[i].getTime()) / (24 * 60 * 60 * 1000)));

describe("calculateOccurrences", () => {
  // ==========================================================================
  // ONE-TIME
  // ==========================================================================

  describe("one-time", () => {
    it("fires exactly once when startDate falls inside the window", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-15" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual(["2026-01-15"]);
    });

    it("fires when startDate is the first day of the window", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-01" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual(["2026-01-01"]);
    });

    it("fires when startDate is the last day of the window", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-31" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual(["2026-01-31"]);
    });

    it("returns nothing when startDate is before viewStartDate", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-05" },
        "2026-01-10",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([]);
    });

    it("returns nothing when startDate is after viewEndDate", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-02-05" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([]);
    });

    it("ignores endDate when endDate is later than startDate", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-15", endDate: "2026-06-30" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual(["2026-01-15"]);
    });

    it("returns nothing when endDate precedes startDate", () => {
      const result = occ(
        { frequency: "one-time", startDate: "2026-01-15", endDate: "2026-01-10" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([]);
    });

    describe("weekendAdjustment", () => {
      it("moves a Saturday back to the preceding Friday with 'before'", () => {
        const result = occ(
          { frequency: "one-time", startDate: "2026-02-07", weekendAdjustment: "before" },
          "2026-02-01",
          "2026-02-28"
        );

        // 2026-02-07 is a Saturday; "before" walks back one day to Friday.
        expect(ymdAll(result)).toEqual(["2026-02-06"]);
        expect(weekday(result[0])).toBe("Fri");
      });

      it("moves a Sunday back to the preceding Friday with 'before'", () => {
        const result = occ(
          { frequency: "one-time", startDate: "2026-02-08", weekendAdjustment: "before" },
          "2026-02-01",
          "2026-02-28"
        );

        // 2026-02-08 is a Sunday; "before" walks back two days to Friday.
        expect(ymdAll(result)).toEqual(["2026-02-06"]);
        expect(weekday(result[0])).toBe("Fri");
      });

      it("moves a Saturday forward to the following Monday with 'after'", () => {
        const result = occ(
          { frequency: "one-time", startDate: "2026-02-07", weekendAdjustment: "after" },
          "2026-02-01",
          "2026-02-28"
        );

        expect(ymdAll(result)).toEqual(["2026-02-09"]);
        expect(weekday(result[0])).toBe("Mon");
      });

      it("moves a Sunday forward to the following Monday with 'after'", () => {
        const result = occ(
          { frequency: "one-time", startDate: "2026-02-08", weekendAdjustment: "after" },
          "2026-02-01",
          "2026-02-28"
        );

        expect(ymdAll(result)).toEqual(["2026-02-09"]);
        expect(weekday(result[0])).toBe("Mon");
      });

      it("leaves a weekend date untouched with 'none'", () => {
        const saturday = occ(
          { frequency: "one-time", startDate: "2026-02-07", weekendAdjustment: "none" },
          "2026-02-01",
          "2026-02-28"
        );
        const sunday = occ(
          { frequency: "one-time", startDate: "2026-02-08", weekendAdjustment: "none" },
          "2026-02-01",
          "2026-02-28"
        );

        expect(ymdAll(saturday)).toEqual(["2026-02-07"]);
        expect(weekday(saturday[0])).toBe("Sat");
        expect(ymdAll(sunday)).toEqual(["2026-02-08"]);
        expect(weekday(sunday[0])).toBe("Sun");
      });

      it("leaves a weekday untouched under every adjustment mode", () => {
        // 2026-01-15 is a Thursday, so no mode may move it.
        for (const mode of ["before", "after", "none"] as const) {
          const result = occ(
            { frequency: "one-time", startDate: "2026-01-15", weekendAdjustment: mode },
            "2026-01-01",
            "2026-01-31"
          );
          expect(ymdAll(result)).toEqual(["2026-01-15"]);
        }
      });
    });
  });

  // ==========================================================================
  // DAILY
  // ==========================================================================

  describe("daily", () => {
    it("emits every day from startDate through viewEndDate inclusive", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-05" },
        "2026-01-01",
        "2026-01-12"
      );

      expect(ymdAll(result)).toEqual(daysBetween("2026-01-05", "2026-01-12"));
    });

    it("clips to viewStartDate when startDate is earlier than the window", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-01" },
        "2026-01-10",
        "2026-01-14"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-10",
        "2026-01-11",
        "2026-01-12",
        "2026-01-13",
        "2026-01-14",
      ]);
    });

    it("truncates at endDate when endDate is earlier than viewEndDate", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-10", endDate: "2026-01-12" },
        "2026-01-10",
        "2026-01-31"
      );

      // effectiveEnd = min(endDate, viewEndDate) = 2026-01-12, inclusive.
      expect(ymdAll(result)).toEqual(["2026-01-10", "2026-01-11", "2026-01-12"]);
    });

    it("keeps viewEndDate as effectiveEnd when endDate is later", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-10", endDate: "2026-12-31" },
        "2026-01-10",
        "2026-01-13"
      );

      expect(ymdAll(result)).toEqual(["2026-01-10", "2026-01-11", "2026-01-12", "2026-01-13"]);
    });

    it("yields exactly one date for a single-day window", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-01" },
        "2026-01-15",
        "2026-01-15"
      );

      expect(ymdAll(result)).toEqual(["2026-01-15"]);
    });

    it("returns nothing when startDate is after the window", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-03-01" },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([]);
    });

    it("leaves weekend days in place with 'none'", () => {
      // 2026-02-07 is a Saturday and 2026-02-08 a Sunday: both survive verbatim.
      const result = occ(
        { frequency: "daily", startDate: "2026-02-05", weekendAdjustment: "none" },
        "2026-02-05",
        "2026-02-11"
      );

      expect(ymdAll(result)).toEqual(daysBetween("2026-02-05", "2026-02-11"));
      expect(duplicates(ymdAll(result))).toEqual([]);
    });

    it("advances exactly one day between consecutive occurrences", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-01" },
        "2026-01-01",
        "2026-01-20"
      );

      expect(gaps(result)).toEqual(new Array(19).fill(1));
    });

    it("silently truncates a long window at the 500-occurrence safety cap", () => {
      // Window is 2026-01-01..2028-01-01 (731 days) but MAX_OCCURRENCES = 500,
      // so the last emitted day is 2026-01-01 + 499 days = 2027-05-15.
      const result = occ(
        { frequency: "daily", startDate: "2026-01-01" },
        "2026-01-01",
        "2028-01-01"
      );

      expect(result).toHaveLength(500);
      expect(daysBetween("2026-01-01", "2027-05-15")).toHaveLength(500);
      expect(ymd(result[0])).toBe("2026-01-01");
      expect(ymd(result[499])).toBe("2027-05-15");
      // Silent: no error, no marker — the remaining 231 days are simply absent.
      expect(result[499] < d("2028-01-01")).toBe(true);
      expect(ymdAll(result)).toEqual(daysBetween("2026-01-01", "2027-05-15"));
    });

    describe("known defects", () => {
      /**
       * DEFECT: `adjustForWeekend` is applied to every generated day
       * independently, so Fri/Sat/Sun all collapse onto the same adjusted date
       * and the daily series emits duplicates.
       * Correct behaviour: the returned dates must be unique (one occurrence
       * per calendar day).
       * Source: app/lib/logic/projectionEngine/occurrenceCalculator.ts:50-57
       * (push of `adjustForWeekend(current, ...)` inside the per-day loop).
       */
      it.fails(
        "KNOWN DEFECT: daily with 'after' collapses Sat and Sun onto Monday, duplicating it",
        () => {
          const result = ymdAll(
            occ(
              { frequency: "daily", startDate: "2026-02-05", weekendAdjustment: "after" },
              "2026-02-05",
              "2026-02-11"
            )
          );

          // Actual: Feb 7 (Sat) -> Feb 9, Feb 8 (Sun) -> Feb 9, Feb 9 -> Feb 9.
          expect(duplicates(result)).toEqual([]);
        }
      );

      /**
       * DEFECT: same root cause as above, mirrored — with "before", Fri, Sat
       * and Sun all collapse onto the preceding Friday.
       * Correct behaviour: the returned dates must be unique.
       * Source: app/lib/logic/projectionEngine/occurrenceCalculator.ts:50-57
       */
      it.fails("KNOWN DEFECT: daily with 'before' collapses Fri, Sat and Sun onto Friday", () => {
        const result = ymdAll(
          occ(
            { frequency: "daily", startDate: "2026-02-05", weekendAdjustment: "before" },
            "2026-02-05",
            "2026-02-11"
          )
        );

        // Actual: Feb 6 (Fri), Feb 7 (Sat) -> Feb 6, Feb 8 (Sun) -> Feb 6.
        expect(duplicates(result)).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // WEEKLY
  // ==========================================================================

  describe("weekly", () => {
    it("steps 7 days from startDate when dayOfWeek is absent", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: {} },
        "2026-01-01",
        "2026-02-15"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
        "2026-02-05",
        "2026-02-12",
      ]);
      expect(result.map(weekday)).toEqual(new Array(7).fill("Thu"));
    });

    it("aligns forward to scheduleConfig.dayOfWeek", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 1 } },
        "2026-01-01",
        "2026-02-01"
      );

      // startDate is Thu 2026-01-01; the first Monday on/after it is 2026-01-05.
      expect(ymdAll(result)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
      expect(result.map(weekday)).toEqual(["Mon", "Mon", "Mon", "Mon"]);
    });

    it("aligns forward to a Friday dayOfWeek", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 5 } },
        "2026-01-01",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-02",
        "2026-01-09",
        "2026-01-16",
        "2026-01-23",
        "2026-01-30",
      ]);
      expect(result.map(weekday)).toEqual(new Array(5).fill("Fri"));
    });

    it("needs no shift when dayOfWeek already equals startDate's weekday", () => {
      const aligned = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 4 } },
        "2026-01-01",
        "2026-01-31"
      );
      const implicit = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: {} },
        "2026-01-01",
        "2026-01-31"
      );

      // 2026-01-01 is a Thursday (day 4), so the alignment loop never runs.
      expect(ymdAll(aligned)).toEqual([
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
      ]);
      expect(ymdAll(aligned)).toEqual(ymdAll(implicit));
    });

    it("skips occurrences before viewStartDate while keeping alignment anchored to startDate", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01" },
        "2026-01-20",
        "2026-02-15"
      );

      // The series still runs on Thursdays from 2026-01-01; the ones before
      // 2026-01-20 (a Tuesday) are dropped rather than re-phased to viewStart.
      expect(ymdAll(result)).toEqual(["2026-01-22", "2026-01-29", "2026-02-05", "2026-02-12"]);
      expect(result.map(weekday)).toEqual(new Array(4).fill("Thu"));
    });

    it("keeps a 7-day gap between consecutive occurrences", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01" },
        "2026-01-01",
        "2026-03-31"
      );

      expect(gaps(result)).toEqual(new Array(result.length - 1).fill(7));
    });

    it("truncates at endDate when endDate is earlier than viewEndDate", () => {
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01", endDate: "2026-01-20" },
        "2026-01-01",
        "2026-03-01"
      );

      expect(ymdAll(result)).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
    });

    it("terminates instead of looping forever when dayOfWeek can never be matched", () => {
      // dayOfWeek 7 is out of range (0-6). The alignment guard stops after 7
      // single-day steps, which lands exactly one week past startDate.
      const result = occ(
        { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 7 } },
        "2026-01-01",
        "2026-02-01"
      );

      expect(ymdAll(result)).toEqual(["2026-01-08", "2026-01-15", "2026-01-22", "2026-01-29"]);
      expect(result.map(weekday)).toEqual(new Array(4).fill("Thu"));
    });

    describe("weekendAdjustment", () => {
      it("moves a Saturday series back to Fridays with 'before'", () => {
        const result = occ(
          { frequency: "weekly", startDate: "2026-01-03", weekendAdjustment: "before" },
          "2026-01-01",
          "2026-01-31"
        );

        // Saturdays Jan 3/10/17/24/31 each shift back one day.
        expect(ymdAll(result)).toEqual([
          "2026-01-02",
          "2026-01-09",
          "2026-01-16",
          "2026-01-23",
          "2026-01-30",
        ]);
        expect(result.map(weekday)).toEqual(new Array(5).fill("Fri"));
      });

      it("moves a Saturday series forward to Mondays with 'after'", () => {
        const result = occ(
          { frequency: "weekly", startDate: "2026-01-03", weekendAdjustment: "after" },
          "2026-01-01",
          "2026-01-28"
        );

        // Saturdays Jan 3/10/17/24 each shift forward two days.
        expect(ymdAll(result)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
        expect(result.map(weekday)).toEqual(new Array(4).fill("Mon"));
      });

      it("moves a Sunday series back to Fridays with 'before' and forward to Mondays with 'after'", () => {
        // 2026-01-04 is a Sunday.
        const before = occ(
          { frequency: "weekly", startDate: "2026-01-04", weekendAdjustment: "before" },
          "2026-01-01",
          "2026-01-31"
        );
        const after = occ(
          { frequency: "weekly", startDate: "2026-01-04", weekendAdjustment: "after" },
          "2026-01-01",
          "2026-01-31"
        );

        // Sundays Jan 4 / 11 / 18 / 25 shift back two days; "after" shifts forward one.
        expect(ymdAll(before)).toEqual(["2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23"]);
        expect(before.map(weekday)).toEqual(new Array(4).fill("Fri"));
        expect(ymdAll(after)).toEqual(["2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26"]);
        expect(after.map(weekday)).toEqual(new Array(4).fill("Mon"));
      });

      it("leaves a Saturday series untouched with 'none'", () => {
        const result = occ(
          { frequency: "weekly", startDate: "2026-01-03", weekendAdjustment: "none" },
          "2026-01-01",
          "2026-01-31"
        );

        expect(ymdAll(result)).toEqual([
          "2026-01-03",
          "2026-01-10",
          "2026-01-17",
          "2026-01-24",
          "2026-01-31",
        ]);
        expect(result.map(weekday)).toEqual(new Array(5).fill("Sat"));
      });
    });
  });

  // ==========================================================================
  // BI-WEEKLY
  // ==========================================================================

  describe("bi-weekly", () => {
    it("defaults to a 2-week interval when intervalWeeks is absent", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: {} },
        "2026-01-01",
        "2026-03-01"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-01",
        "2026-01-15",
        "2026-01-29",
        "2026-02-12",
        "2026-02-26",
      ]);
    });

    it("treats intervalWeeks 1 as a weekly cadence", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { intervalWeeks: 1 } },
        "2026-01-01",
        "2026-02-15"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
        "2026-02-05",
        "2026-02-12",
      ]);
    });

    it("honours intervalWeeks 3", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { intervalWeeks: 3 } },
        "2026-01-01",
        "2026-04-01"
      );

      expect(ymdAll(result)).toEqual([
        "2026-01-01",
        "2026-01-22",
        "2026-02-12",
        "2026-03-05",
        "2026-03-26",
      ]);
    });

    it("honours intervalWeeks 4", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { intervalWeeks: 4 } },
        "2026-01-01",
        "2026-04-01"
      );

      expect(ymdAll(result)).toEqual(["2026-01-01", "2026-01-29", "2026-02-26", "2026-03-26"]);
    });

    it("spaces consecutive occurrences exactly intervalWeeks * 7 days apart", () => {
      for (const intervalWeeks of [1, 2, 3, 4]) {
        const result = occ(
          { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { intervalWeeks } },
          "2026-01-01",
          "2026-06-30"
        );

        expect(result.length).toBeGreaterThan(1);
        expect(gaps(result)).toEqual(new Array(result.length - 1).fill(intervalWeeks * 7));
      }
    });

    it("aligns forward to scheduleConfig.dayOfWeek before stepping", () => {
      const result = occ(
        {
          frequency: "bi-weekly",
          startDate: "2026-01-01",
          scheduleConfig: { dayOfWeek: 5, intervalWeeks: 2 },
        },
        "2026-01-01",
        "2026-03-01"
      );

      // First Friday on/after Thu 2026-01-01 is 2026-01-02, then every 14 days.
      expect(ymdAll(result)).toEqual([
        "2026-01-02",
        "2026-01-16",
        "2026-01-30",
        "2026-02-13",
        "2026-02-27",
      ]);
      expect(result.map(weekday)).toEqual(new Array(5).fill("Fri"));
    });

    it("needs no shift when dayOfWeek already equals startDate's weekday", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 4 } },
        "2026-01-01",
        "2026-02-15"
      );

      expect(ymdAll(result)).toEqual(["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12"]);
    });

    it("terminates instead of looping forever when dayOfWeek can never be matched", () => {
      // dayOfWeek 7 is out of range; the guard stops after 7 daily steps.
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: { dayOfWeek: 7 } },
        "2026-01-01",
        "2026-03-01"
      );

      expect(ymdAll(result)).toEqual(["2026-01-08", "2026-01-22", "2026-02-05", "2026-02-19"]);
    });

    it("skips occurrences before viewStartDate while keeping the phase anchored to startDate", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01" },
        "2026-01-20",
        "2026-03-01"
      );

      // Phase stays on the Jan 1 / Jan 15 / Jan 29 ... series; it is not
      // restarted at viewStartDate.
      expect(ymdAll(result)).toEqual(["2026-01-29", "2026-02-12", "2026-02-26"]);
    });

    it("truncates at endDate when endDate is earlier than viewEndDate", () => {
      const result = occ(
        { frequency: "bi-weekly", startDate: "2026-01-01", endDate: "2026-02-01" },
        "2026-01-01",
        "2026-06-30"
      );

      expect(ymdAll(result)).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
    });

    describe("weekendAdjustment", () => {
      it("moves a Saturday series back to Fridays with 'before'", () => {
        const result = occ(
          { frequency: "bi-weekly", startDate: "2026-01-03", weekendAdjustment: "before" },
          "2026-01-01",
          "2026-02-28"
        );

        // Saturdays Jan 3 / 17 / 31 / Feb 14 / 28, each shifted back one day.
        expect(ymdAll(result)).toEqual([
          "2026-01-02",
          "2026-01-16",
          "2026-01-30",
          "2026-02-13",
          "2026-02-27",
        ]);
        expect(result.map(weekday)).toEqual(new Array(5).fill("Fri"));
      });

      it("moves a Saturday series forward to Mondays with 'after'", () => {
        const result = occ(
          { frequency: "bi-weekly", startDate: "2026-01-03", weekendAdjustment: "after" },
          "2026-01-01",
          "2026-02-20"
        );

        // Saturdays Jan 3 / 17 / 31 / Feb 14, each shifted forward two days.
        expect(ymdAll(result)).toEqual(["2026-01-05", "2026-01-19", "2026-02-02", "2026-02-16"]);
        expect(result.map(weekday)).toEqual(new Array(4).fill("Mon"));
      });

      it("leaves a Saturday series untouched with 'none'", () => {
        const result = occ(
          { frequency: "bi-weekly", startDate: "2026-01-03", weekendAdjustment: "none" },
          "2026-01-01",
          "2026-02-28"
        );

        expect(ymdAll(result)).toEqual([
          "2026-01-03",
          "2026-01-17",
          "2026-01-31",
          "2026-02-14",
          "2026-02-28",
        ]);
        expect(result.map(weekday)).toEqual(new Array(5).fill("Sat"));
      });
    });
  });

  // ==========================================================================
  // EMPTY RESULTS AND DEFAULTING
  // ==========================================================================

  describe("empty results", () => {
    it("returns [] for every short-cycle frequency when startDate is after effectiveEnd", () => {
      for (const frequency of ["one-time", "daily", "weekly", "bi-weekly"] as const) {
        const result = occ({ frequency, startDate: "2026-05-01" }, "2026-01-01", "2026-01-31");
        expect(ymdAll(result)).toEqual([]);
      }
    });

    it("returns [] when endDate is before viewStartDate", () => {
      for (const frequency of ["one-time", "daily", "weekly", "bi-weekly"] as const) {
        const result = occ(
          { frequency, startDate: "2025-11-06", endDate: "2025-12-01" },
          "2026-01-01",
          "2026-01-31"
        );
        expect(ymdAll(result)).toEqual([]);
      }
    });

    it("returns [] when endDate equals startDate but the window starts later", () => {
      const result = occ(
        { frequency: "daily", startDate: "2026-01-05", endDate: "2026-01-05" },
        "2026-01-10",
        "2026-01-31"
      );

      expect(ymdAll(result)).toEqual([]);
    });
  });

  describe("missing scheduleConfig", () => {
    it("does not throw and falls back to schedule defaults when scheduleConfig is undefined", () => {
      const undefinedConfig = undefined as unknown as IncomeSource["scheduleConfig"];

      const weekly = () =>
        occ(
          { frequency: "weekly", startDate: "2026-01-01", scheduleConfig: undefinedConfig },
          "2026-01-01",
          "2026-01-31"
        );
      const biweekly = () =>
        occ(
          { frequency: "bi-weekly", startDate: "2026-01-01", scheduleConfig: undefinedConfig },
          "2026-01-01",
          "2026-03-01"
        );
      const daily = () =>
        occ(
          { frequency: "daily", startDate: "2026-01-01", scheduleConfig: undefinedConfig },
          "2026-01-01",
          "2026-01-03"
        );
      const oneTime = () =>
        occ(
          { frequency: "one-time", startDate: "2026-01-15", scheduleConfig: undefinedConfig },
          "2026-01-01",
          "2026-01-31"
        );

      expect(weekly).not.toThrow();
      expect(biweekly).not.toThrow();
      expect(daily).not.toThrow();
      expect(oneTime).not.toThrow();

      // No dayOfWeek/intervalWeeks: weekly steps 7 days, bi-weekly 14.
      expect(ymdAll(weekly())).toEqual([
        "2026-01-01",
        "2026-01-08",
        "2026-01-15",
        "2026-01-22",
        "2026-01-29",
      ]);
      expect(ymdAll(biweekly())).toEqual([
        "2026-01-01",
        "2026-01-15",
        "2026-01-29",
        "2026-02-12",
        "2026-02-26",
      ]);
      expect(ymdAll(daily())).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
      expect(ymdAll(oneTime())).toEqual(["2026-01-15"]);
    });
  });

  // ==========================================================================
  // KNOWN DEFECTS SPANNING THE SHORT-CYCLE BRANCHES
  // ==========================================================================

  describe("known defects", () => {
    /**
     * DEFECT: weekend adjustment is applied AFTER the window/end filter, so an
     * adjusted date can escape the window it was filtered into. Every branch
     * pushes `adjustForWeekend(...)` without re-checking the bounds.
     * Correct behaviour: every returned date lies within
     * [viewStartDate, viewEndDate] and never past endDate.
     * Source: app/lib/logic/projectionEngine/occurrenceCalculator.ts:45, 53, 75, 98
     */
    it.fails("KNOWN DEFECT: one-time with 'after' emits a date past viewEndDate", () => {
      const viewEnd = d("2026-02-07"); // Saturday, the last day of the window
      const result = calculateOccurrences(
        params({ frequency: "one-time", startDate: "2026-02-07", weekendAdjustment: "after" }),
        d("2026-02-01"),
        viewEnd
      );

      // Actual: ["2026-02-09"] — two days beyond the requested window.
      expect(ymdAll(result.filter((date) => date > viewEnd))).toEqual([]);
    });

    /**
     * DEFECT (same root cause, occurrenceCalculator.ts:53): the daily branch
     * clips the cursor to viewStartDate and then shifts a Sunday backwards,
     * emitting a date before the window began.
     * Correct behaviour: no returned date is earlier than viewStartDate.
     */
    it.fails("KNOWN DEFECT: daily with 'before' emits a date earlier than viewStartDate", () => {
      const viewStart = d("2026-02-08"); // Sunday, the first day of the window
      const result = calculateOccurrences(
        params({ frequency: "daily", startDate: "2026-02-08", weekendAdjustment: "before" }),
        viewStart,
        d("2026-02-11")
      );

      // Actual: first element is 2026-02-06 (the preceding Friday).
      expect(ymdAll(result.filter((date) => date < viewStart))).toEqual([]);
    });

    /**
     * DEFECT (same root cause, occurrenceCalculator.ts:75): a weekly series
     * whose last in-range occurrence is the endDate itself gets pushed past
     * that endDate by the "after" adjustment.
     * Correct behaviour: no returned date is later than endDate.
     */
    it.fails("KNOWN DEFECT: weekly with 'after' emits a date past endDate", () => {
      const endDate = d("2026-01-17"); // Saturday, the rule's own end date
      const result = calculateOccurrences(
        params({
          frequency: "weekly",
          startDate: "2026-01-03",
          endDate: "2026-01-17",
          weekendAdjustment: "after",
        }),
        d("2026-01-01"),
        d("2026-03-01")
      );

      // Actual: ["2026-01-05","2026-01-12","2026-01-19"] — Jan 19 is past the end date.
      expect(ymdAll(result.filter((date) => date > endDate))).toEqual([]);
    });

    /**
     * DEFECT (same root cause, occurrenceCalculator.ts:98): the bi-weekly
     * branch shifts a Sunday occurrence that lands on the final day of the
     * window into the following month.
     * Correct behaviour: no returned date is later than viewEndDate.
     */
    it.fails("KNOWN DEFECT: bi-weekly with 'after' emits a date past viewEndDate", () => {
      const viewEnd = d("2026-03-01"); // Sunday, the last day of the window
      const result = calculateOccurrences(
        params({
          frequency: "bi-weekly",
          startDate: "2026-01-04", // Sunday
          weekendAdjustment: "after",
        }),
        d("2026-01-01"),
        viewEnd
      );

      // Actual: the 2026-03-01 occurrence is emitted as 2026-03-02.
      expect(ymdAll(result.filter((date) => date > viewEnd))).toEqual([]);
    });
  });
});
