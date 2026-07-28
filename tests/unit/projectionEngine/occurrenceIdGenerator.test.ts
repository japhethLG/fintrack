import { describe, it, expect } from "vitest";

import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { calculateOccurrences } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";

import { d, ymd, ymdAll, weekday, duplicates } from "../../helpers/dates";

/**
 * `generateOccurrenceId` is the identity backbone of the projection engine: the
 * id must name the LOGICAL RECURRENCE PERIOD ("rent, March 2026"), not the
 * calendar date the occurrence happens to land on, so overrides / completions
 * stay attached when the date moves (weekend adjustment, drag & drop, rule
 * edits) — see the module docstring at
 * app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:1-6.
 */

const SRC = "src";

/** Call the SUT with local-midnight dates and the default 2026-01-01 anchor. */
const idFor = (
  frequency: IncomeFrequency,
  dateYmd: string,
  startDate = "2026-01-01",
  scheduleConfig: ScheduleConfig = {}
): string => generateOccurrenceId(SRC, frequency, d(dateYmd), startDate, scheduleConfig);

/**
 * Independent ISO-8601 week-date reference, written from the spec rather than
 * from the engine's arithmetic: the Thursday of a week decides its ISO year,
 * and week 1 is the week holding that year's Jan 4 / first Thursday.
 */
const isoWeekRef = (dateYmd: string): { year: number; week: number } => {
  const date = d(dateYmd);
  const mondayOffset = (date.getDay() + 6) % 7; // Mon = 0 ... Sun = 6
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset + 3);
  const year = thursday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const dayIndex = Math.round((thursday.getTime() - jan1.getTime()) / 86400000);
  return { year, week: 1 + Math.floor(dayIndex / 7) };
};

const isoWeekIdRef = (dateYmd: string): string => {
  const { year, week } = isoWeekRef(dateYmd);
  return `${SRC}_${year}-W${String(week).padStart(2, "0")}`;
};

/**
 * Test-side weekend adjustment, mirroring the documented rule in
 * app/lib/logic/projectionEngine/dateUtils.ts:20-33 (Sat/Sun -> Fri for
 * "before", -> Mon for "after"). Reimplemented locally so the identity-drift
 * tests do not depend on the engine's own date arithmetic.
 */
const adjustWeekend = (dateYmd: string, mode: "before" | "after"): string => {
  const date = d(dateYmd);
  const day = date.getDay();
  if (day !== 0 && day !== 6) return dateYmd;
  const shift = day === 0 ? (mode === "before" ? -2 : 1) : mode === "before" ? -1 : 2;
  date.setDate(date.getDate() + shift);
  return ymd(date);
};

/** Every day of a calendar month as "YYYY-MM-DD", for sweep assertions. */
const daysOfMonth = (year: number, month1: number): string[] => {
  const last = new Date(year, month1, 0).getDate();
  return Array.from({ length: last }, (_, i) => ymd(new Date(year, month1 - 1, i + 1)));
};

describe("generateOccurrenceId", () => {
  describe("one-time", () => {
    it("uses the fixed _once suffix so the single occurrence has one identity", () => {
      expect(idFor("one-time", "2026-01-01")).toBe("src_once");
    });

    it("keeps the same id no matter where the occurrence is scheduled", () => {
      const ids = ["2020-02-29", "2026-01-01", "2026-06-15", "2031-12-31"].map((day) =>
        idFor("one-time", day)
      );
      expect(new Set(ids)).toEqual(new Set(["src_once"]));
    });

    it("ignores startDate and scheduleConfig entirely", () => {
      expect(
        idFor("one-time", "2026-06-15", "1999-01-01", { dayOfMonth: 9, specificDays: [3] })
      ).toBe("src_once");
    });
  });

  describe("daily", () => {
    it("names the calendar day of the occurrence", () => {
      expect(idFor("daily", "2026-03-09")).toBe("src_2026-03-09");
    });

    it("zero-pads single-digit months and days", () => {
      expect(idFor("daily", "2026-01-05")).toBe("src_2026-01-05");
    });

    it("gives every day of a month its own id", () => {
      const ids = daysOfMonth(2026, 1).map((day) => idFor("daily", day));
      expect(ids).toHaveLength(31);
      expect(duplicates(ids)).toEqual([]);
      expect(ids[0]).toBe("src_2026-01-01");
      expect(ids[30]).toBe("src_2026-01-31");
    });

    it("ignores startDate — the occurrence's own day is the period", () => {
      expect(idFor("daily", "2026-03-09", "2001-07-07")).toBe("src_2026-03-09");
    });
  });

  describe("weekly", () => {
    // 2026-01-01 is a Thursday, so ISO week 2026-W01 runs Mon 2025-12-29 .. Sun 2026-01-04.
    it("labels the ISO week containing the occurrence", () => {
      expect(idFor("weekly", "2026-01-01")).toBe("src_2026-W01");
    });

    it("zero-pads the week number to two digits", () => {
      // Mon 2026-01-05 opens the second ISO week of 2026.
      expect(idFor("weekly", "2026-01-05")).toBe("src_2026-W02");
    });

    it("does not pad week numbers beyond two digits", () => {
      expect(idFor("weekly", "2026-06-15")).toBe("src_2026-W25");
    });

    it("maps the Monday and the Sunday of one ISO week to the same id", () => {
      // Thursday pivot: both Mon 2025-12-29 and Sun 2026-01-04 sit in the week
      // whose Thursday is 2026-01-01, hence both are 2026-W01.
      expect(idFor("weekly", "2025-12-29")).toBe("src_2026-W01");
      expect(idFor("weekly", "2026-01-04")).toBe("src_2026-W01");
      expect(idFor("weekly", "2025-12-29")).toBe(idFor("weekly", "2026-01-04"));
    });

    it("gives all seven days of one ISO week a single shared id", () => {
      const week = [
        "2026-01-05",
        "2026-01-06",
        "2026-01-07",
        "2026-01-08",
        "2026-01-09",
        "2026-01-10",
        "2026-01-11",
      ];
      expect(new Set(week.map((day) => idFor("weekly", day)))).toEqual(new Set(["src_2026-W02"]));
    });

    it("puts the last days of December into the next year's week 1 when they belong there", () => {
      // Mon 2025-12-29 .. Wed 2025-12-31 are in the week whose Thursday is
      // 2026-01-01, so they carry the 2026 week-year, not 2025.
      expect(idFor("weekly", "2025-12-29")).toBe("src_2026-W01");
      expect(idFor("weekly", "2025-12-31")).toBe("src_2026-W01");
      // Sun 2025-12-28 closes the previous week and stays in 2025.
      expect(idFor("weekly", "2025-12-28")).toBe("src_2025-W52");
    });

    it("keeps early January in the previous week-year when the week started in December", () => {
      // 2026 starts on a Thursday, so 2026 has 53 ISO weeks; 2027-01-01 (Fri)
      // and 2027-01-03 (Sun) still belong to 2026-W53.
      expect(idFor("weekly", "2026-12-28")).toBe("src_2026-W53");
      expect(idFor("weekly", "2026-12-31")).toBe("src_2026-W53");
      expect(idFor("weekly", "2027-01-01")).toBe("src_2026-W53");
      expect(idFor("weekly", "2027-01-03")).toBe("src_2026-W53");
      // Mon 2027-01-04 opens 2027-W01.
      expect(idFor("weekly", "2027-01-04")).toBe("src_2027-W01");
    });

    it("matches an independent ISO-8601 reference across every year boundary from 2018 to 2035", () => {
      const boundaryDays: string[] = [];
      for (let year = 2018; year <= 2035; year++) {
        for (const day of ["12-26", "12-27", "12-28", "12-29", "12-30", "12-31"]) {
          boundaryDays.push(`${year}-${day}`);
        }
        for (const day of ["01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07"]) {
          boundaryDays.push(`${year}-${day}`);
        }
      }
      const actual = boundaryDays.map((day) => idFor("weekly", day));
      const expected = boundaryDays.map((day) => isoWeekIdRef(day));
      expect(actual).toEqual(expected);
    });

    it("matches an independent ISO-8601 reference for every day of a full year", () => {
      const allDays: string[] = [];
      for (let month = 1; month <= 12; month++) allDays.push(...daysOfMonth(2026, month));
      expect(allDays.map((day) => idFor("weekly", day))).toEqual(
        allDays.map((day) => isoWeekIdRef(day))
      );
    });

    it("ignores startDate — the ISO week alone identifies the period", () => {
      expect(idFor("weekly", "2026-06-15", "1999-01-01")).toBe("src_2026-W25");
    });
  });

  describe("bi-weekly", () => {
    it("numbers the start date itself as occurrence 1", () => {
      expect(idFor("bi-weekly", "2026-01-01", "2026-01-01")).toBe("src_BW1");
    });

    it("keeps the whole 14-day window after the start date in occurrence 1", () => {
      // diffDays 0..13 -> floor(diff / 14) + 1 === 1
      expect(idFor("bi-weekly", "2026-01-07", "2026-01-01")).toBe("src_BW1");
      expect(idFor("bi-weekly", "2026-01-14", "2026-01-01")).toBe("src_BW1");
    });

    it("advances to occurrence 2 exactly 14 days after the start date", () => {
      expect(idFor("bi-weekly", "2026-01-15", "2026-01-01")).toBe("src_BW2");
    });

    it("increments once per 14-day interval", () => {
      const days = ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26"];
      expect(days.map((day) => idFor("bi-weekly", day, "2026-01-01"))).toEqual([
        "src_BW1",
        "src_BW2",
        "src_BW3",
        "src_BW4",
        "src_BW5",
      ]);
    });

    it("defaults to a 2-week interval when scheduleConfig is empty", () => {
      expect(idFor("bi-weekly", "2026-01-15", "2026-01-01", {})).toBe("src_BW2");
    });

    it("honours a 1-week custom interval", () => {
      const days = ["2026-01-01", "2026-01-08", "2026-01-15"];
      expect(
        days.map((day) => idFor("bi-weekly", day, "2026-01-01", { intervalWeeks: 1 }))
      ).toEqual(["src_BW1", "src_BW2", "src_BW3"]);
    });

    it("honours a 3-week custom interval", () => {
      // 21-day buckets: day 20 is still #1, day 21 opens #2.
      expect(idFor("bi-weekly", "2026-01-21", "2026-01-01", { intervalWeeks: 3 })).toBe("src_BW1");
      expect(idFor("bi-weekly", "2026-01-22", "2026-01-01", { intervalWeeks: 3 })).toBe("src_BW2");
      expect(idFor("bi-weekly", "2026-02-12", "2026-01-01", { intervalWeeks: 3 })).toBe("src_BW3");
    });

    it("honours a 4-week custom interval", () => {
      // 28-day buckets from 2026-01-01.
      expect(idFor("bi-weekly", "2026-01-28", "2026-01-01", { intervalWeeks: 4 })).toBe("src_BW1");
      expect(idFor("bi-weekly", "2026-01-29", "2026-01-01", { intervalWeeks: 4 })).toBe("src_BW2");
      expect(idFor("bi-weekly", "2026-02-26", "2026-01-01", { intervalWeeks: 4 })).toBe("src_BW3");
    });

    it("treats intervalWeeks 0 as the 2-week default instead of dividing by zero", () => {
      // `scheduleConfig.intervalWeeks || 2` — 0 is falsy, so the default applies.
      expect(idFor("bi-weekly", "2026-01-15", "2026-01-01", { intervalWeeks: 0 })).toBe("src_BW2");
    });

    it("numbers a date before the start date with a non-positive index", () => {
      // floor(diffDays / 14) + 1: diff -1..-14 -> 0, diff -15..-28 -> -1.
      // Arithmetically consistent (each 14-day bucket keeps its own index) but
      // the "occurrence number" reads as 0 / negative, which no caller expects.
      expect(idFor("bi-weekly", "2025-12-31", "2026-01-01")).toBe("src_BW0");
      expect(idFor("bi-weekly", "2025-12-18", "2026-01-01")).toBe("src_BW0");
      expect(idFor("bi-weekly", "2025-12-17", "2026-01-01")).toBe("src_BW-1");
    });

    it("does not collide across the start-date boundary", () => {
      const days = ["2025-12-17", "2025-12-31", "2026-01-01", "2026-01-15"];
      const ids = days.map((day) => idFor("bi-weekly", day, "2026-01-01"));
      expect(ids).toEqual(["src_BW-1", "src_BW0", "src_BW1", "src_BW2"]);
      expect(duplicates(ids)).toEqual([]);
    });

    it("keeps distinct ids for every occurrence of a weekend-adjusted schedule", () => {
      // A bi-weekly rule anchored on Sat 2026-01-03 with "before" adjustment
      // lands on Fridays; the whole series shifts one bucket down (BW0, BW1, ...)
      // but stays collision-free.
      const adjusted = ["2026-01-03", "2026-01-17", "2026-01-31"].map((day) =>
        adjustWeekend(day, "before")
      );
      expect(adjusted).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
      const ids = adjusted.map((day) => idFor("bi-weekly", day, "2026-01-03"));
      expect(ids).toEqual(["src_BW0", "src_BW1", "src_BW2"]);
      expect(duplicates(ids)).toEqual([]);
    });
  });

  describe("semi-monthly", () => {
    it("defaults to the 15th and 30th slots", () => {
      expect(idFor("semi-monthly", "2026-03-15")).toBe("src_2026-03-1");
      expect(idFor("semi-monthly", "2026-03-30")).toBe("src_2026-03-2");
    });

    it("numbers slots 1-based in ascending day order", () => {
      const cfg: ScheduleConfig = { specificDays: [5, 15, 25] };
      expect(idFor("semi-monthly", "2026-04-05", "2026-01-01", cfg)).toBe("src_2026-04-1");
      expect(idFor("semi-monthly", "2026-04-15", "2026-01-01", cfg)).toBe("src_2026-04-2");
      expect(idFor("semi-monthly", "2026-04-25", "2026-01-01", cfg)).toBe("src_2026-04-3");
    });

    it("sorts unsorted specificDays before assigning slot numbers", () => {
      const cfg: ScheduleConfig = { specificDays: [30, 15] };
      expect(idFor("semi-monthly", "2026-03-15", "2026-01-01", cfg)).toBe("src_2026-03-1");
      expect(idFor("semi-monthly", "2026-03-30", "2026-01-01", cfg)).toBe("src_2026-03-2");
    });

    it("de-duplicates repeated specificDays so slot numbers stay stable", () => {
      const withDupes: ScheduleConfig = { specificDays: [30, 15, 30, 15] };
      expect(idFor("semi-monthly", "2026-03-15", "2026-01-01", withDupes)).toBe("src_2026-03-1");
      expect(idFor("semi-monthly", "2026-03-30", "2026-01-01", withDupes)).toBe("src_2026-03-2");
      expect(idFor("semi-monthly", "2026-03-30", "2026-01-01", withDupes)).toBe(
        idFor("semi-monthly", "2026-03-30", "2026-01-01", { specificDays: [15, 30] })
      );
    });

    it("falls back to slot 1 for a day at or below the first scheduled day", () => {
      // 2026-03-10 is not a scheduled day; 10 <= 15 -> slot 1.
      expect(idFor("semi-monthly", "2026-03-10")).toBe("src_2026-03-1");
      expect(idFor("semi-monthly", "2026-03-01")).toBe("src_2026-03-1");
      // Exactly on the first scheduled day is still slot 1 via the exact match.
      expect(idFor("semi-monthly", "2026-03-15")).toBe("src_2026-03-1");
    });

    it("falls back to slot 2 for a day above the first scheduled day", () => {
      expect(idFor("semi-monthly", "2026-03-16")).toBe("src_2026-03-2");
      expect(idFor("semi-monthly", "2026-03-29")).toBe("src_2026-03-2");
      expect(idFor("semi-monthly", "2026-03-31")).toBe("src_2026-03-2");
    });

    it("zero-pads the month while leaving the slot index unpadded", () => {
      expect(idFor("semi-monthly", "2026-01-15")).toBe("src_2026-01-1");
      expect(idFor("semi-monthly", "2026-09-30")).toBe("src_2026-09-2");
    });

    it("scopes slot numbers to the calendar month", () => {
      expect(idFor("semi-monthly", "2026-03-15")).not.toBe(idFor("semi-monthly", "2026-04-15"));
      expect(idFor("semi-monthly", "2026-04-15")).toBe("src_2026-04-1");
    });

    it("ignores startDate", () => {
      expect(idFor("semi-monthly", "2026-03-30", "1999-06-06")).toBe("src_2026-03-2");
    });
  });

  describe("monthly", () => {
    it("names the calendar month of the occurrence", () => {
      expect(idFor("monthly", "2026-03-05")).toBe("src_2026-03");
    });

    it("zero-pads single-digit months", () => {
      expect(idFor("monthly", "2026-01-01")).toBe("src_2026-01");
      expect(idFor("monthly", "2026-09-30")).toBe("src_2026-09");
    });

    it("gives each of the twelve months of a year its own id", () => {
      const ids = Array.from({ length: 12 }, (_, i) =>
        idFor("monthly", `2026-${String(i + 1).padStart(2, "0")}-10`)
      );
      expect(ids).toEqual([
        "src_2026-01",
        "src_2026-02",
        "src_2026-03",
        "src_2026-04",
        "src_2026-05",
        "src_2026-06",
        "src_2026-07",
        "src_2026-08",
        "src_2026-09",
        "src_2026-10",
        "src_2026-11",
        "src_2026-12",
      ]);
    });

    it("separates the same month in different years", () => {
      expect(idFor("monthly", "2026-03-05")).not.toBe(idFor("monthly", "2027-03-05"));
      expect(idFor("monthly", "2027-03-05")).toBe("src_2027-03");
    });

    it("ignores dayOfMonth in scheduleConfig", () => {
      expect(idFor("monthly", "2026-03-05", "2026-01-01", { dayOfMonth: 28 })).toBe("src_2026-03");
    });
  });

  describe("quarterly", () => {
    it("maps all twelve months onto Q1..Q4", () => {
      const ids = Array.from({ length: 12 }, (_, i) =>
        idFor("quarterly", `2026-${String(i + 1).padStart(2, "0")}-10`)
      );
      expect(ids).toEqual([
        "src_2026-Q1",
        "src_2026-Q1",
        "src_2026-Q1",
        "src_2026-Q2",
        "src_2026-Q2",
        "src_2026-Q2",
        "src_2026-Q3",
        "src_2026-Q3",
        "src_2026-Q3",
        "src_2026-Q4",
        "src_2026-Q4",
        "src_2026-Q4",
      ]);
    });

    it("gives every day inside a quarter the same id", () => {
      const days = ["2026-07-01", "2026-08-15", "2026-09-30"];
      expect(new Set(days.map((day) => idFor("quarterly", day)))).toEqual(new Set(["src_2026-Q3"]));
    });

    it("separates the same quarter in different years", () => {
      expect(idFor("quarterly", "2026-02-10")).toBe("src_2026-Q1");
      expect(idFor("quarterly", "2027-02-10")).toBe("src_2027-Q1");
    });
  });

  describe("yearly", () => {
    it("names the calendar year of the occurrence", () => {
      expect(idFor("yearly", "2026-07-04")).toBe("src_2026");
    });

    it("gives every day of a year the same id", () => {
      const days = ["2026-01-01", "2026-06-15", "2026-12-31"];
      expect(new Set(days.map((day) => idFor("yearly", day)))).toEqual(new Set(["src_2026"]));
    });

    it("separates consecutive years", () => {
      expect(idFor("yearly", "2026-12-31")).toBe("src_2026");
      expect(idFor("yearly", "2027-01-01")).toBe("src_2027");
    });
  });

  describe("unrecognised frequency", () => {
    it("falls back to the calendar day of the occurrence", () => {
      expect(idFor("fortnightly" as unknown as IncomeFrequency, "2026-03-09")).toBe(
        "src_2026-03-09"
      );
    });

    it("falls back for an empty-string frequency", () => {
      expect(idFor("" as never, "2026-03-09")).toBe("src_2026-03-09");
    });

    it("produces the same shape as daily for an unknown frequency", () => {
      expect(idFor("weekly-ish" as never, "2026-12-31")).toBe(idFor("daily", "2026-12-31"));
    });
  });

  describe("stability across rescheduling", () => {
    it("keeps one id for a monthly occurrence moved anywhere inside its month", () => {
      // This is the property that lets a user drag a bill from the 1st to the
      // 28th without orphaning its override / completion record.
      const ids = ["2026-03-01", "2026-03-15", "2026-03-28"].map((day) => idFor("monthly", day));
      expect(ids).toEqual(["src_2026-03", "src_2026-03", "src_2026-03"]);
      expect(new Set(ids).size).toBe(1);
    });

    it("keeps one id for a quarterly occurrence moved anywhere inside its quarter", () => {
      const ids = ["2026-01-01", "2026-02-14", "2026-03-31"].map((day) => idFor("quarterly", day));
      expect(new Set(ids)).toEqual(new Set(["src_2026-Q1"]));
    });

    it("keeps one id for a yearly occurrence moved anywhere inside its year", () => {
      const ids = ["2026-02-01", "2026-11-30"].map((day) => idFor("yearly", day));
      expect(new Set(ids)).toEqual(new Set(["src_2026"]));
    });

    it("keeps the weekly id when weekend adjustment moves a Sunday back into the same ISO week", () => {
      // Sun 2026-01-11 -> Fri 2026-01-09 under "before": still 2026-W02.
      const before = adjustWeekend("2026-01-11", "before");
      expect(before).toBe("2026-01-09");
      expect(weekday(before)).toBe("Fri");
      expect(idFor("weekly", before)).toBe(idFor("weekly", "2026-01-11"));
      expect(idFor("weekly", before)).toBe("src_2026-W02");
    });

    it("keeps the monthly id when weekend adjustment stays inside the month", () => {
      // Sun 2026-03-15 -> Fri 2026-03-13 under "before".
      const before = adjustWeekend("2026-03-15", "before");
      expect(before).toBe("2026-03-13");
      expect(idFor("monthly", before)).toBe(idFor("monthly", "2026-03-15"));
    });

    it("keeps the semi-monthly slot when weekend adjustment stays inside the month", () => {
      // Sun 2026-03-15 (slot 1 of [15, 30]) -> Fri 2026-03-13; 13 <= 15 so the
      // nearest-slot fallback still resolves to slot 1.
      const before = adjustWeekend("2026-03-15", "before");
      expect(idFor("semi-monthly", before)).toBe(idFor("semi-monthly", "2026-03-15"));
      expect(idFor("semi-monthly", before)).toBe("src_2026-03-1");
    });

    it("gives two different calendar days two different daily ids", () => {
      expect(idFor("daily", "2026-01-03")).not.toBe(idFor("daily", "2026-01-04"));
      expect(idFor("daily", "2026-01-03")).toBe("src_2026-01-03");
      expect(idFor("daily", "2026-01-04")).toBe("src_2026-01-04");
    });
  });

  describe("source isolation", () => {
    it("never collides between two sources sharing the same period", () => {
      const frequencies: IncomeFrequency[] = [
        "one-time",
        "daily",
        "weekly",
        "bi-weekly",
        "semi-monthly",
        "monthly",
        "quarterly",
        "yearly",
      ];
      for (const frequency of frequencies) {
        const a = generateOccurrenceId("rent", frequency, d("2026-03-15"), "2026-01-01", {});
        const b = generateOccurrenceId("salary", frequency, d("2026-03-15"), "2026-01-01", {});
        expect(a).not.toBe(b);
        expect(a.startsWith("rent_")).toBe(true);
        expect(b.startsWith("salary_")).toBe(true);
      }
    });

    it("produces globally unique ids across sources, frequencies and periods", () => {
      const frequencies: IncomeFrequency[] = [
        "one-time",
        "daily",
        "weekly",
        "bi-weekly",
        "semi-monthly",
        "monthly",
        "quarterly",
        "yearly",
      ];
      const ids: string[] = [];
      for (const source of ["a", "b", "c"]) {
        for (const frequency of frequencies) {
          for (const day of ["2026-01-15", "2026-04-15", "2026-08-15"]) {
            ids.push(generateOccurrenceId(source, frequency, d(day), "2026-01-01", {}));
          }
        }
      }
      // Within one source, coarse frequencies intentionally repeat (yearly gives
      // one id for all three days), so de-duplicate before checking that no id
      // ever leaks across sources.
      const perSource = new Map<string, Set<string>>();
      for (const id of new Set(ids)) {
        const source = id.split("_")[0];
        if (!perSource.has(source)) perSource.set(source, new Set());
        perSource.get(source)!.add(id);
      }
      expect(perSource.size).toBe(3);
      const suffixes = [...perSource.values()].map(
        (set) => new Set([...set].map((id) => id.slice(id.indexOf("_") + 1)))
      );
      expect(suffixes[0]).toEqual(suffixes[1]);
      expect(suffixes[0]).toEqual(suffixes[2]);
    });

    it("keeps ids distinct for sources whose names share a prefix", () => {
      expect(generateOccurrenceId("rent", "monthly", d("2026-03-05"), "2026-01-01", {})).toBe(
        "rent_2026-03"
      );
      expect(generateOccurrenceId("rent_car", "monthly", d("2026-03-05"), "2026-01-01", {})).toBe(
        "rent_car_2026-03"
      );
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (daily + weekend adjustment): occurrenceCalculator.ts:50-57 emits
     * one occurrence per calendar day and pushes each through
     * `adjustForWeekend`, which collapses Sat, Sun and Mon onto the same Monday
     * under "after". `generateOccurrenceId` then derives the daily id from that
     * ADJUSTED date (occurrenceIdGenerator.ts:67-68), so three distinct daily
     * occurrences share a single id.
     * Correct behaviour: three occurrences => three distinct ids. Completing or
     * overriding the Monday occurrence currently also completes/overrides the
     * Saturday and Sunday ones, and de-duplication upstream silently drops two
     * days of income/expense.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:67-68
     * (with app/lib/logic/projectionEngine/occurrenceCalculator.ts:50-57).
     */
    it.fails(
      "KNOWN DEFECT: daily occurrences on Sat, Sun and Mon keep three distinct ids under weekend adjustment",
      () => {
        const adjusted = ["2026-01-03", "2026-01-04", "2026-01-05"].map((day) =>
          adjustWeekend(day, "after")
        );
        // Sat -> Mon (+2), Sun -> Mon (+1), Mon unchanged: all three land on 2026-01-05.
        expect(adjusted).toEqual(["2026-01-05", "2026-01-05", "2026-01-05"]);
        const ids = adjusted.map((day) => idFor("daily", day));
        expect(duplicates(ids)).toEqual([]);
        expect(new Set(ids).size).toBe(3);
      }
    );

    /**
     * Same defect, driven end-to-end through the real occurrence calculator so
     * the collision is shown on production output rather than a test fixture.
     * Source: app/lib/logic/projectionEngine/occurrenceCalculator.ts:50-57 ->
     * app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:67-68.
     */
    it.fails("KNOWN DEFECT: a daily schedule over a weekend produces one id per occurrence", () => {
      const occurrences = calculateOccurrences(
        {
          frequency: "daily",
          startDate: "2026-01-02",
          scheduleConfig: {},
          weekendAdjustment: "after",
        },
        d("2026-01-02"),
        d("2026-01-05")
      );
      // Fri, Sat, Sun, Mon -> Fri, Mon, Mon, Mon
      expect(ymdAll(occurrences)).toEqual(["2026-01-02", "2026-01-05", "2026-01-05", "2026-01-05"]);
      const ids = occurrences.map((date) =>
        generateOccurrenceId(SRC, "daily", date, "2026-01-02", {})
      );
      expect(ids).toHaveLength(4);
      expect(duplicates(ids)).toEqual([]);
    });

    /**
     * DEFECT (monthly + weekend adjustment across a month boundary): the
     * monthly id is built from the ADJUSTED date's month
     * (occurrenceIdGenerator.ts:86-87). Sun 2026-03-01 becomes Fri 2026-02-27
     * under "before", so the March occurrence is labelled `src_2026-02`.
     * Correct behaviour: the id must name the logical period (March 2026) and
     * stay `src_2026-03` regardless of where the date lands — that is the
     * explicit promise of the module docstring (lines 1-6).
     * Consequence: the occurrence's logical identity silently changes, so any
     * override / completion / skip stored under `src_2026-03` is orphaned. Worse,
     * the shifted March occurrence now shares February's namespace and can
     * collide with the real February occurrence (see the next test).
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:86-87.
     */
    it.fails(
      "KNOWN DEFECT: a monthly occurrence shifted into the previous month keeps its own month's id",
      () => {
        const adjusted = adjustWeekend("2026-03-01", "before");
        expect(adjusted).toBe("2026-02-27");
        expect(weekday("2026-03-01")).toBe("Sun");
        expect(idFor("monthly", adjusted)).toBe("src_2026-03");
      }
    );

    /**
     * DEFECT (monthly id collision across a month boundary): with the id taken
     * from the adjusted date, the March occurrence shifted to 2026-02-27 lands
     * in February's id namespace. If the rule also has a February occurrence
     * that stays in February, both occurrences resolve to `src_2026-02`.
     * Correct behaviour: two occurrences must never share an id.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:86-87.
     */
    it.fails("KNOWN DEFECT: monthly ids stay unique when an occurrence shifts month", () => {
      const february = idFor("monthly", "2026-02-16");
      const shiftedMarch = idFor("monthly", adjustWeekend("2026-03-01", "before"));
      expect(shiftedMarch).not.toBe(february);
    });

    /**
     * DEFECT (weekly + weekend adjustment across an ISO week boundary): Saturday
     * is the last day of its ISO week, so "after" adjustment pushes it to the
     * following Monday, which is week N+1. The weekly id is derived from the
     * adjusted date (occurrenceIdGenerator.ts:70-73), so a weekly-on-Saturday
     * rule labels every occurrence with the NEXT week.
     * Correct behaviour: the occurrence belongs to 2026-W02 and must keep
     * `src_2026-W02`. Today, toggling weekendAdjustment off shifts every id back
     * one week and orphans every stored override.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:70-73.
     */
    it.fails(
      "KNOWN DEFECT: a weekly Saturday occurrence keeps its own ISO week id when moved to Monday",
      () => {
        const adjusted = adjustWeekend("2026-01-10", "after");
        expect(adjusted).toBe("2026-01-12");
        expect(weekday("2026-01-10")).toBe("Sat");
        expect(idFor("weekly", "2026-01-10")).toBe("src_2026-W02");
        expect(idFor("weekly", adjusted)).toBe("src_2026-W02");
      }
    );

    /**
     * DEFECT (quarterly + weekend adjustment across a quarter boundary): 2028-01-01
     * is a Saturday; "before" moves it to Fri 2027-12-31, so the Q1-2028
     * occurrence is labelled `src_2027-Q4`.
     * Correct behaviour: the id must stay `src_2028-Q1`.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:89-92.
     */
    it.fails(
      "KNOWN DEFECT: a quarterly occurrence shifted into the previous quarter keeps its own quarter id",
      () => {
        const adjusted = adjustWeekend("2028-01-01", "before");
        expect(adjusted).toBe("2027-12-31");
        expect(weekday("2028-01-01")).toBe("Sat");
        expect(idFor("quarterly", adjusted)).toBe("src_2028-Q1");
      }
    );

    /**
     * DEFECT (yearly + weekend adjustment across a year boundary): same root
     * cause in the yearly id space — Sat 2028-01-01 shifted to Fri 2027-12-31
     * is labelled `src_2027`, colliding with the previous year's occurrence.
     * Correct behaviour: the id must stay `src_2028`.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:94-95.
     */
    it.fails(
      "KNOWN DEFECT: a yearly occurrence shifted into the previous year keeps its own year id",
      () => {
        const adjusted = adjustWeekend("2028-01-01", "before");
        expect(idFor("yearly", adjusted)).toBe("src_2028");
        // …and must not collide with the 2027 occurrence.
        expect(idFor("yearly", adjusted)).not.toBe(idFor("yearly", "2027-06-01"));
      }
    );

    /**
     * DEFECT (semi-monthly nearest-slot fallback is capped at 2): the fallback is
     * `day <= sorted[0] ? 1 : 2` (occurrenceIdGenerator.ts:43-44), so with three
     * or more specificDays it can never return slot 3 or beyond. Any non-exact
     * day above the first scheduled day is forced into slot 2, losing the
     * information about which slot the occurrence actually belongs to.
     * Correct behaviour: the fallback should pick the genuinely nearest slot —
     * day 24 with [5, 15, 25] belongs to slot 3, and day 28 (past the last slot)
     * also belongs to slot 3.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:43-44.
     */
    it.fails(
      "KNOWN DEFECT: the semi-monthly fallback resolves to slots beyond 2 when there are 3+ scheduled days",
      () => {
        const cfg: ScheduleConfig = { specificDays: [5, 15, 25] };
        expect(idFor("semi-monthly", "2026-04-24", "2026-01-01", cfg)).toBe("src_2026-04-3");
        expect(idFor("semi-monthly", "2026-04-28", "2026-01-01", cfg)).toBe("src_2026-04-3");
      }
    );

    /**
     * DEFECT (semi-monthly id collision from the capped fallback): with
     * specificDays [5, 15, 25], the 25th of April 2026 is a Saturday and moves
     * to Fri 2026-04-24 under "before". The fallback maps day 24 to slot 2 —
     * exactly the slot the 15th already owns — so two occurrences in the same
     * month share `src_2026-04-2`.
     * Correct behaviour: distinct occurrences must never share an id.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:43-44.
     */
    it.fails("KNOWN DEFECT: semi-monthly ids stay unique when a slot is weekend-adjusted", () => {
      const cfg: ScheduleConfig = { specificDays: [5, 15, 25] };
      expect(weekday("2026-04-25")).toBe("Sat");
      const shifted = adjustWeekend("2026-04-25", "before");
      expect(shifted).toBe("2026-04-24");
      const slot2 = idFor("semi-monthly", "2026-04-15", "2026-01-01", cfg);
      const shiftedSlot3 = idFor("semi-monthly", shifted, "2026-01-01", cfg);
      expect(shiftedSlot3).not.toBe(slot2);
    });

    /**
     * DEFECT (semi-monthly first slot crossing a month boundary): with
     * specificDays [1, 15], Sun 2026-03-01 moves to Fri 2026-02-27 under
     * "before". The id is then built from February AND from the capped fallback
     * (27 > 1 -> slot 2), producing `src_2026-02-2` — the exact id February's own
     * 15th occurrence gets (Sun 2026-02-15 -> Fri 2026-02-13 is slot 1, but an
     * unadjusted 15th is slot 2). Two occurrences, one id.
     * Correct behaviour: the March slot-1 occurrence must keep `src_2026-03-1`.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:37-44 and
     * :81-84.
     */
    it.fails(
      "KNOWN DEFECT: a semi-monthly slot-1 occurrence shifted into the previous month keeps its own month and slot",
      () => {
        const cfg: ScheduleConfig = { specificDays: [1, 15] };
        const shifted = adjustWeekend("2026-03-01", "before");
        expect(shifted).toBe("2026-02-27");
        expect(idFor("semi-monthly", shifted, "2026-01-01", cfg)).toBe("src_2026-03-1");
      }
    );

    /**
     * DEFECT (bi-weekly identity is anchored to a mutable startDate): the
     * bi-weekly id counts intervals from the rule's startDate
     * (occurrenceIdGenerator.ts:29-35, :75-79). Editing startDate renumbers
     * every occurrence, so an occurrence on a given calendar date changes
     * identity — e.g. 2026-01-15 is BW2 from a 2026-01-01 anchor but BW1 from a
     * 2026-01-08 anchor.
     * Correct behaviour: per the module docstring (lines 1-6) the id must survive
     * "rule date changes", which requires deriving the period from the
     * occurrence's own calendar position (e.g. an absolute epoch-week index)
     * rather than from a mutable anchor. Today, moving a pay-cycle anchor
     * orphans every recorded completion and override on the rule.
     * Source: app/lib/logic/projectionEngine/occurrenceIdGenerator.ts:29-35.
     */
    it.fails(
      "KNOWN DEFECT: a bi-weekly occurrence keeps its id when the rule's startDate is edited",
      () => {
        const beforeEdit = idFor("bi-weekly", "2026-01-15", "2026-01-01");
        const afterEdit = idFor("bi-weekly", "2026-01-15", "2026-01-08");
        expect(beforeEdit).toBe("src_BW2");
        expect(afterEdit).toBe(beforeEdit);
      }
    );
  });
});
