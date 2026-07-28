import { describe, it, expect } from "vitest";

import {
  isWeekend,
  adjustForWeekend,
  getLastDayOfMonth,
  clampDayToMonth,
} from "@/lib/logic/projectionEngine/dateUtils";
import {
  DATE_FORMAT,
  parseDate,
  formatDate,
  isSameDay,
  startOfDay,
  getTodayKey,
  addDays,
  addWeeks,
  addMonths,
  addYears,
} from "@/lib/utils/dateUtils";

import { d, ymd, weekday } from "../../helpers/dates";
import { freezeToday, freezeAt } from "../../helpers/time";

/**
 * Local helper: assert that a function did not mutate the Date it was handed.
 *
 * Deliberately compares the raw epoch value (not a formatted string) so a
 * mutation of the time-of-day is caught as well as a calendar-day shift.
 * Kept local because tests/helpers/dates.ts has no immutability helper.
 */
const expectUnmutated = (input: Date, expectedYmd: string, run: (date: Date) => unknown): void => {
  const before = input.getTime();
  run(input);
  expect(input.getTime()).toBe(before);
  expect(ymd(input)).toBe(expectedYmd);
};

/**
 * Concrete, hand-verified calendar week used throughout the weekend tests.
 * 2026-06-01 is a Monday, so this week runs Mon -> Sun with no ambiguity.
 */
const WEEK_2026_06 = [
  { day: "2026-06-01", name: "Mon" },
  { day: "2026-06-02", name: "Tue" },
  { day: "2026-06-03", name: "Wed" },
  { day: "2026-06-04", name: "Thu" },
  { day: "2026-06-05", name: "Fri" },
  { day: "2026-06-06", name: "Sat" },
  { day: "2026-06-07", name: "Sun" },
] as const;

describe("isWeekend", () => {
  it("labels every weekday of the 2026-06-01 week correctly", () => {
    // Sanity-check the fixture itself with the test-side weekday helper so a
    // wrong assumption about the calendar shows up here, not as a false pass.
    expect(WEEK_2026_06.map((entry) => weekday(entry.day))).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);

    expect(WEEK_2026_06.map((entry) => isWeekend(d(entry.day)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("returns true for Saturday", () => {
    expect(isWeekend(d("2026-06-06"))).toBe(true);
  });

  it("returns true for Sunday", () => {
    expect(isWeekend(d("2026-06-07"))).toBe(true);
  });

  it("returns false for Monday through Friday", () => {
    expect(isWeekend(d("2026-06-01"))).toBe(false);
    expect(isWeekend(d("2026-06-02"))).toBe(false);
    expect(isWeekend(d("2026-06-03"))).toBe(false);
    expect(isWeekend(d("2026-06-04"))).toBe(false);
    expect(isWeekend(d("2026-06-05"))).toBe(false);
  });

  it("ignores the time of day when classifying a weekend", () => {
    // Saturday 2026-06-06 at 23:59:59 local is still a weekend.
    expect(isWeekend(new Date(2026, 5, 6, 23, 59, 59, 999))).toBe(true);
    // Friday 2026-06-05 at 23:59:59 local is still a weekday.
    expect(isWeekend(new Date(2026, 5, 5, 23, 59, 59, 999))).toBe(false);
  });

  it("does not mutate the date it inspects", () => {
    expectUnmutated(d("2026-06-06"), "2026-06-06", (date) => isWeekend(date));
  });
});

describe("adjustForWeekend", () => {
  describe('adjustment "none"', () => {
    it("returns the same calendar day for a Saturday", () => {
      expect(ymd(adjustForWeekend(d("2026-06-06"), "none"))).toBe("2026-06-06");
    });

    it("returns the same calendar day for a Sunday", () => {
      expect(ymd(adjustForWeekend(d("2026-06-07"), "none"))).toBe("2026-06-07");
    });

    it("returns the same calendar day for every weekday", () => {
      const results = WEEK_2026_06.map((entry) => ymd(adjustForWeekend(d(entry.day), "none")));
      expect(results).toEqual(WEEK_2026_06.map((entry) => entry.day));
    });

    it("returns the very same Date instance rather than a copy", () => {
      // Pinned deliberately: the returned Date is the caller's own object, so
      // callers that keep the result must clone it (occurrenceCalculator wraps
      // the cursor in `new Date(current)` before calling for exactly this
      // reason). app/lib/logic/projectionEngine/dateUtils.ts:21
      const input = d("2026-06-06");
      expect(adjustForWeekend(input, "none")).toBe(input);
    });

    it("preserves the time of day", () => {
      const result = adjustForWeekend(new Date(2026, 5, 6, 14, 30, 15, 250), "none");
      expect(ymd(result)).toBe("2026-06-06");
      expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([14, 30, 15]);
    });
  });

  describe('adjustment "before"', () => {
    it("maps Sunday back two days to Friday", () => {
      const result = adjustForWeekend(d("2026-06-07"), "before");
      expect(ymd(result)).toBe("2026-06-05");
      expect(weekday(result)).toBe("Fri");
    });

    it("maps Saturday back one day to Friday", () => {
      const result = adjustForWeekend(d("2026-06-06"), "before");
      expect(ymd(result)).toBe("2026-06-05");
      expect(weekday(result)).toBe("Fri");
    });

    it("leaves Monday through Friday untouched", () => {
      const weekdays = WEEK_2026_06.filter((entry) => entry.name !== "Sat" && entry.name !== "Sun");
      expect(weekdays.map((entry) => ymd(adjustForWeekend(d(entry.day), "before")))).toEqual([
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
        "2026-06-04",
        "2026-06-05",
      ]);
    });

    it("preserves the time of day when shifting", () => {
      // Sunday 2026-06-07 09:15 -> Friday 2026-06-05 09:15.
      const result = adjustForWeekend(new Date(2026, 5, 7, 9, 15, 45, 500), "before");
      expect(ymd(result)).toBe("2026-06-05");
      expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([9, 15, 45]);
    });

    it("returns a new Date instance when it actually shifts a weekend day", () => {
      const input = d("2026-06-07");
      expect(adjustForWeekend(input, "before")).not.toBe(input);
    });

    it("returns the same Date instance for a weekday (no shift needed)", () => {
      // app/lib/logic/projectionEngine/dateUtils.ts:32 returns `date` as-is.
      const input = d("2026-06-03");
      expect(adjustForWeekend(input, "before")).toBe(input);
    });
  });

  describe('adjustment "after"', () => {
    it("maps Sunday forward one day to Monday", () => {
      const result = adjustForWeekend(d("2026-06-07"), "after");
      expect(ymd(result)).toBe("2026-06-08");
      expect(weekday(result)).toBe("Mon");
    });

    it("maps Saturday forward two days to Monday", () => {
      const result = adjustForWeekend(d("2026-06-06"), "after");
      expect(ymd(result)).toBe("2026-06-08");
      expect(weekday(result)).toBe("Mon");
    });

    it("leaves Monday through Friday untouched", () => {
      const weekdays = WEEK_2026_06.filter((entry) => entry.name !== "Sat" && entry.name !== "Sun");
      expect(weekdays.map((entry) => ymd(adjustForWeekend(d(entry.day), "after")))).toEqual([
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
        "2026-06-04",
        "2026-06-05",
      ]);
    });

    it("preserves the time of day when shifting", () => {
      // Saturday 2026-06-06 18:05 -> Monday 2026-06-08 18:05.
      const result = adjustForWeekend(new Date(2026, 5, 6, 18, 5, 0, 0), "after");
      expect(ymd(result)).toBe("2026-06-08");
      expect([result.getHours(), result.getMinutes()]).toEqual([18, 5]);
    });

    it("returns a new Date instance when it actually shifts a weekend day", () => {
      const input = d("2026-06-06");
      expect(adjustForWeekend(input, "after")).not.toBe(input);
    });

    it("returns the same Date instance for a weekday (no shift needed)", () => {
      const input = d("2026-06-04");
      expect(adjustForWeekend(input, "after")).toBe(input);
    });
  });

  describe("month boundaries", () => {
    it("moves Saturday 2026-02-28 forward into March", () => {
      // Feb 2026 ends on Saturday the 28th; +2 days lands on Monday 2026-03-02.
      const result = adjustForWeekend(d("2026-02-28"), "after");
      expect(ymd(result)).toBe("2026-03-02");
      expect(weekday(result)).toBe("Mon");
    });

    it("moves Sunday 2026-03-01 back into February", () => {
      // 2026-03-01 is a Sunday; -2 days lands on Friday 2026-02-27.
      const result = adjustForWeekend(d("2026-03-01"), "before");
      expect(ymd(result)).toBe("2026-02-27");
      expect(weekday(result)).toBe("Fri");
    });

    it("moves Sunday 2026-03-01 forward to Monday 2026-03-02", () => {
      expect(ymd(adjustForWeekend(d("2026-03-01"), "after"))).toBe("2026-03-02");
    });

    it("moves Saturday 2026-02-28 back to Friday 2026-02-27", () => {
      expect(ymd(adjustForWeekend(d("2026-02-28"), "before"))).toBe("2026-02-27");
    });

    it("crosses a 30-day month boundary", () => {
      // 2026-05-31 is a Sunday; +1 day is Monday 2026-06-01.
      expect(weekday("2026-05-31")).toBe("Sun");
      expect(ymd(adjustForWeekend(d("2026-05-31"), "after"))).toBe("2026-06-01");
    });
  });

  describe("year boundaries", () => {
    it("moves Sunday 2026-01-04 back to Friday 2026-01-02", () => {
      const result = adjustForWeekend(d("2026-01-04"), "before");
      expect(ymd(result)).toBe("2026-01-02");
      expect(weekday(result)).toBe("Fri");
    });

    it("moves Sunday 2028-01-02 back into the previous year", () => {
      // 2028-01-02 is a Sunday; -2 days lands on Friday 2027-12-31.
      expect(weekday("2028-01-02")).toBe("Sun");
      const result = adjustForWeekend(d("2028-01-02"), "before");
      expect(ymd(result)).toBe("2027-12-31");
      expect(weekday(result)).toBe("Fri");
    });

    it("moves Saturday 2028-01-01 back into the previous year", () => {
      // New Year's Day 2028 is a Saturday; -1 day lands on Friday 2027-12-31.
      expect(weekday("2028-01-01")).toBe("Sat");
      expect(ymd(adjustForWeekend(d("2028-01-01"), "before"))).toBe("2027-12-31");
    });

    it("moves Saturday 2028-12-30 forward into the next year", () => {
      // 2028-12-30 is a Saturday; +2 days lands on Monday 2029-01-01.
      expect(weekday("2028-12-30")).toBe("Sat");
      const result = adjustForWeekend(d("2028-12-30"), "after");
      expect(ymd(result)).toBe("2029-01-01");
      expect(weekday(result)).toBe("Mon");
    });

    it("moves Sunday 2028-12-31 forward into the next year", () => {
      // 2028-12-31 is a Sunday; +1 day lands on Monday 2029-01-01.
      expect(weekday("2028-12-31")).toBe("Sun");
      expect(ymd(adjustForWeekend(d("2028-12-31"), "after"))).toBe("2029-01-01");
    });

    it("keeps a leap-day Tuesday untouched in all three modes", () => {
      // 2028-02-29 is a Tuesday, so no mode should move it.
      expect(weekday("2028-02-29")).toBe("Tue");
      expect(ymd(adjustForWeekend(d("2028-02-29"), "none"))).toBe("2028-02-29");
      expect(ymd(adjustForWeekend(d("2028-02-29"), "before"))).toBe("2028-02-29");
      expect(ymd(adjustForWeekend(d("2028-02-29"), "after"))).toBe("2028-02-29");
    });
  });

  describe("input immutability", () => {
    // The cursor Dates in occurrenceCalculator are reused after the call, so a
    // mutating implementation would silently corrupt every later occurrence.
    const modes = ["none", "before", "after"] as const;

    it.each(modes)('does not mutate a Saturday input with adjustment "%s"', (mode) => {
      expectUnmutated(d("2026-06-06"), "2026-06-06", (date) => adjustForWeekend(date, mode));
    });

    it.each(modes)('does not mutate a Sunday input with adjustment "%s"', (mode) => {
      expectUnmutated(d("2026-06-07"), "2026-06-07", (date) => adjustForWeekend(date, mode));
    });

    it.each(modes)('does not mutate a weekday input with adjustment "%s"', (mode) => {
      expectUnmutated(d("2026-06-03"), "2026-06-03", (date) => adjustForWeekend(date, mode));
    });

    it("does not mutate the input when the shift crosses a year boundary", () => {
      expectUnmutated(d("2028-01-02"), "2028-01-02", (date) => adjustForWeekend(date, "before"));
    });

    it("leaves the input untouched even when the returned Date is later mutated", () => {
      const input = d("2026-06-06");
      const result = adjustForWeekend(input, "after");
      result.setDate(result.getDate() + 10);
      expect(ymd(input)).toBe("2026-06-06");
    });
  });
});

describe("getLastDayOfMonth", () => {
  it("returns the correct length for all twelve months of 2026", () => {
    const lengths = Array.from({ length: 12 }, (_, month) => getLastDayOfMonth(2026, month));
    expect(lengths).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });

  it("treats the month argument as 0-based: index 0 is January (31 days)", () => {
    expect(getLastDayOfMonth(2026, 0)).toBe(31);
  });

  it("treats the month argument as 0-based: index 11 is December (31 days)", () => {
    expect(getLastDayOfMonth(2026, 11)).toBe(31);
  });

  it("returns 29 for February in leap year 2024", () => {
    expect(getLastDayOfMonth(2024, 1)).toBe(29);
  });

  it("returns 29 for February in leap year 2028", () => {
    expect(getLastDayOfMonth(2028, 1)).toBe(29);
  });

  it("returns 28 for February in non-leap year 2026", () => {
    expect(getLastDayOfMonth(2026, 1)).toBe(28);
  });

  it("returns 28 for February in 2100, a century year that is not a leap year", () => {
    // Divisible by 100 but not by 400 -> not a leap year.
    expect(getLastDayOfMonth(2100, 1)).toBe(28);
  });

  it("returns 29 for February in 2000, a century year that is a leap year", () => {
    // Divisible by 400 -> leap year.
    expect(getLastDayOfMonth(2000, 1)).toBe(29);
  });

  it("returns 30 for the four 30-day months", () => {
    // April, June, September, November (0-based indices 3, 5, 8, 10).
    expect([
      getLastDayOfMonth(2026, 3),
      getLastDayOfMonth(2026, 5),
      getLastDayOfMonth(2026, 8),
      getLastDayOfMonth(2026, 10),
    ]).toEqual([30, 30, 30, 30]);
  });
});

describe("clampDayToMonth", () => {
  it("leaves a day that exists in the month unchanged", () => {
    expect(clampDayToMonth(15, 2026, 0)).toBe(15);
  });

  it("leaves the exact last day of the month unchanged", () => {
    expect(clampDayToMonth(30, 2026, 3)).toBe(30);
  });

  it("clamps day 31 to 28 in February of a non-leap year", () => {
    expect(clampDayToMonth(31, 2026, 1)).toBe(28);
  });

  it("clamps day 31 to 29 in February of a leap year", () => {
    expect(clampDayToMonth(31, 2028, 1)).toBe(29);
  });

  it("clamps day 30 to 28 in February of a non-leap year", () => {
    expect(clampDayToMonth(30, 2026, 1)).toBe(28);
  });

  it("clamps day 31 to 30 in April", () => {
    expect(clampDayToMonth(31, 2026, 3)).toBe(30);
  });

  it("keeps day 1 in every month of 2026", () => {
    const clamped = Array.from({ length: 12 }, (_, month) => clampDayToMonth(1, 2026, month));
    expect(clamped).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("keeps day 31 in the seven 31-day months of 2026", () => {
    const months = [0, 2, 4, 6, 7, 9, 11];
    expect(months.map((month) => clampDayToMonth(31, 2026, month))).toEqual([
      31, 31, 31, 31, 31, 31, 31,
    ]);
  });

  it("clamps a day beyond 31 down to the month length", () => {
    expect(clampDayToMonth(45, 2026, 0)).toBe(31);
    expect(clampDayToMonth(45, 2026, 3)).toBe(30);
    expect(clampDayToMonth(45, 2026, 1)).toBe(28);
  });

  it("clamps the semi-monthly default day 30 correctly across a year", () => {
    // The engine's semi-monthly default is [15, 30]; day 30 must survive in
    // 31-day and 30-day months and collapse to the last day of February.
    const clamped = Array.from({ length: 12 }, (_, month) => clampDayToMonth(30, 2026, month));
    expect(clamped).toEqual([30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  });

  it("only clamps downward: a day below 1 is returned as-is", () => {
    // Characterisation test. `Math.min` has no lower bound, so 0 stays 0.
    // Reachable only if a caller passes an invalid day; the engine guards with
    // `scheduleConfig.dayOfMonth || start.getDate()`
    // (app/lib/logic/projectionEngine/occurrenceCalculator.ts:131).
    expect(clampDayToMonth(0, 2026, 0)).toBe(0);
  });
});

describe("DATE_FORMAT", () => {
  it("is the YYYY-MM-DD storage/key format", () => {
    expect(DATE_FORMAT).toBe("YYYY-MM-DD");
  });
});

describe("parseDate", () => {
  it("parses YYYY-MM-DD as LOCAL midnight, not UTC midnight", () => {
    // This is the whole reason the helper exists: `new Date("2026-03-15")`
    // would be UTC midnight, which is the previous calendar day east of UTC.
    const result = parseDate("2026-03-15");
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2);
    expect(result.getDate()).toBe(15);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("produces the same instant as new Date(year, monthIndex, day)", () => {
    expect(parseDate("2026-03-15").getTime()).toBe(new Date(2026, 2, 15).getTime());
  });

  it("parses zero-padded single-digit months and days", () => {
    const result = parseDate("2026-01-05");
    expect(ymd(result)).toBe("2026-01-05");
    expect(result.getHours()).toBe(0);
  });

  it("parses the first and last day of a year at local midnight", () => {
    expect(ymd(parseDate("2026-01-01"))).toBe("2026-01-01");
    expect(ymd(parseDate("2026-12-31"))).toBe("2026-12-31");
    expect(parseDate("2026-12-31").getHours()).toBe(0);
  });

  it("parses a leap day", () => {
    const result = parseDate("2028-02-29");
    expect(ymd(result)).toBe("2028-02-29");
    expect(weekday(result)).toBe("Tue");
  });

  it("returns a Date whose weekday matches the real calendar", () => {
    // 2026-01-01 is a Thursday (the anchor the whole test suite uses).
    expect(weekday(parseDate("2026-01-01"))).toBe("Thu");
  });

  it("returns a fresh Date on each call", () => {
    const first = parseDate("2026-03-15");
    const second = parseDate("2026-03-15");
    expect(first).not.toBe(second);
    expect(first.getTime()).toBe(second.getTime());
  });
});

describe("formatDate", () => {
  it("round-trips with parseDate", () => {
    const keys = ["2026-01-01", "2026-02-28", "2026-06-06", "2026-12-31", "2028-02-29"];
    expect(keys.map((key) => formatDate(parseDate(key)))).toEqual(keys);
  });

  it("zero-pads a single-digit month and day", () => {
    expect(formatDate(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("formats a Date built with new Date(year, monthIndex, day) correctly", () => {
    // monthIndex 11 is December -> the 0-based month must be printed as 12.
    expect(formatDate(new Date(2026, 11, 31))).toBe("2026-12-31");
    expect(formatDate(new Date(2026, 2, 15))).toBe("2026-03-15");
  });

  it("uses the local calendar day and ignores the time of day", () => {
    expect(formatDate(new Date(2026, 5, 6, 23, 59, 59, 999))).toBe("2026-06-06");
    expect(formatDate(new Date(2026, 5, 6, 0, 0, 0, 0))).toBe("2026-06-06");
  });

  it("agrees with the test-side ymd helper across a month boundary", () => {
    const dates = [new Date(2026, 0, 31), new Date(2026, 1, 1), new Date(2026, 1, 28)];
    expect(dates.map(formatDate)).toEqual(dates.map(ymd));
  });

  it("does not mutate the date it formats", () => {
    expectUnmutated(new Date(2026, 5, 6, 12, 30, 0, 0), "2026-06-06", (date) => formatDate(date));
  });
});

describe("isSameDay", () => {
  it("returns true for the same calendar day at different times", () => {
    expect(
      isSameDay(new Date(2026, 2, 15, 0, 0, 0, 0), new Date(2026, 2, 15, 23, 59, 59, 999))
    ).toBe(true);
  });

  it("returns true for two identical instants", () => {
    expect(isSameDay(d("2026-03-15"), d("2026-03-15"))).toBe(true);
  });

  it("returns false for adjacent days", () => {
    expect(isSameDay(d("2026-03-15"), d("2026-03-16"))).toBe(false);
    expect(isSameDay(d("2026-03-16"), d("2026-03-15"))).toBe(false);
  });

  it("returns false one millisecond either side of midnight", () => {
    expect(
      isSameDay(new Date(2026, 2, 15, 23, 59, 59, 999), new Date(2026, 2, 16, 0, 0, 0, 0))
    ).toBe(false);
  });

  it("returns false across a month boundary", () => {
    expect(
      isSameDay(new Date(2026, 0, 31, 23, 59, 59, 999), new Date(2026, 1, 1, 0, 0, 0, 0))
    ).toBe(false);
  });

  it("returns false across a year boundary", () => {
    expect(isSameDay(d("2026-12-31"), d("2027-01-01"))).toBe(false);
  });

  it("returns false for the same day-of-month in different months", () => {
    expect(isSameDay(d("2026-03-15"), d("2026-04-15"))).toBe(false);
  });

  it("returns false for the same day in different years", () => {
    expect(isSameDay(d("2026-03-15"), d("2027-03-15"))).toBe(false);
  });

  it("does not mutate either argument", () => {
    const left = new Date(2026, 2, 15, 8, 0, 0, 0);
    const right = new Date(2026, 2, 15, 20, 0, 0, 0);
    const leftBefore = left.getTime();
    const rightBefore = right.getTime();
    isSameDay(left, right);
    expect(left.getTime()).toBe(leftBefore);
    expect(right.getTime()).toBe(rightBefore);
  });
});

describe("startOfDay", () => {
  it("zeroes hours, minutes, seconds and milliseconds", () => {
    const result = startOfDay(new Date(2026, 4, 17, 13, 45, 30, 123));
    expect([
      result.getHours(),
      result.getMinutes(),
      result.getSeconds(),
      result.getMilliseconds(),
    ]).toEqual([0, 0, 0, 0]);
  });

  it("keeps the same calendar day", () => {
    expect(ymd(startOfDay(new Date(2026, 4, 17, 13, 45, 30, 123)))).toBe("2026-05-17");
  });

  it("keeps the calendar day for a time just before midnight", () => {
    expect(ymd(startOfDay(new Date(2026, 4, 17, 23, 59, 59, 999)))).toBe("2026-05-17");
  });

  it("keeps the calendar day for a time exactly at midnight", () => {
    const midnight = d("2026-05-17");
    expect(startOfDay(midnight).getTime()).toBe(midnight.getTime());
  });

  it("is idempotent", () => {
    const once = startOfDay(new Date(2026, 4, 17, 13, 45, 30, 123));
    const twice = startOfDay(once);
    expect(twice.getTime()).toBe(once.getTime());
  });

  it("returns a new Date and does not mutate its input", () => {
    const input = new Date(2026, 4, 17, 13, 45, 30, 123);
    const result = startOfDay(input);
    expect(result).not.toBe(input);
    expect(input.getHours()).toBe(13);
    expect(input.getMilliseconds()).toBe(123);
  });
});

describe("getTodayKey", () => {
  it("returns the frozen day as YYYY-MM-DD", () => {
    freezeToday("2026-07-28");
    expect(getTodayKey()).toBe("2026-07-28");
  });

  it("zero-pads month and day", () => {
    freezeToday("2026-03-05");
    expect(getTodayKey()).toBe("2026-03-05");
  });

  it("uses the local calendar day late in the evening", () => {
    freezeAt("2026-03-05", 23, 59, 59);
    expect(getTodayKey()).toBe("2026-03-05");
  });

  it("does not roll into the next year on New Year's Eve", () => {
    freezeAt("2026-12-31", 23, 59, 59);
    expect(getTodayKey()).toBe("2026-12-31");
  });

  it("returns the leap day when frozen on 2028-02-29", () => {
    freezeToday("2028-02-29");
    expect(getTodayKey()).toBe("2028-02-29");
  });
});

describe("addDays", () => {
  it("adds a positive number of days", () => {
    expect(ymd(addDays(d("2026-03-15"), 1))).toBe("2026-03-16");
    expect(ymd(addDays(d("2026-03-15"), 10))).toBe("2026-03-25");
  });

  it("subtracts for a negative delta", () => {
    expect(ymd(addDays(d("2026-03-15"), -1))).toBe("2026-03-14");
    expect(ymd(addDays(d("2026-03-15"), -14))).toBe("2026-03-01");
  });

  it("returns the same day for a delta of zero", () => {
    expect(ymd(addDays(d("2026-03-15"), 0))).toBe("2026-03-15");
  });

  it("crosses a month boundary", () => {
    expect(ymd(addDays(d("2026-01-31"), 1))).toBe("2026-02-01");
    expect(ymd(addDays(d("2026-02-01"), -1))).toBe("2026-01-31");
  });

  it("crosses a year boundary in both directions", () => {
    expect(ymd(addDays(d("2026-12-31"), 1))).toBe("2027-01-01");
    expect(ymd(addDays(d("2026-01-01"), -1))).toBe("2025-12-31");
  });

  it("counts the leap day when stepping through February 2028", () => {
    expect(ymd(addDays(d("2028-02-28"), 1))).toBe("2028-02-29");
    expect(ymd(addDays(d("2028-02-28"), 2))).toBe("2028-03-01");
  });

  it("skips straight from Feb 28 to Mar 1 in a non-leap year", () => {
    expect(ymd(addDays(d("2026-02-28"), 1))).toBe("2026-03-01");
  });

  it("keeps midnight when starting from midnight", () => {
    const result = addDays(d("2026-03-15"), 1);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it("preserves a non-midnight time of day", () => {
    const result = addDays(new Date(2026, 2, 15, 17, 45, 30, 250), 3);
    expect(ymd(result)).toBe("2026-03-18");
    expect([result.getHours(), result.getMinutes(), result.getSeconds()]).toEqual([17, 45, 30]);
  });

  it("advances the weekday by the same number of days", () => {
    // 2026-06-05 is a Friday; +3 days is Monday.
    expect(weekday(addDays(d("2026-06-05"), 3))).toBe("Mon");
  });
});

describe("addWeeks", () => {
  it("adds a positive number of weeks", () => {
    expect(ymd(addWeeks(d("2026-01-01"), 2))).toBe("2026-01-15");
  });

  it("subtracts for a negative delta, crossing a year boundary", () => {
    expect(ymd(addWeeks(d("2026-01-01"), -1))).toBe("2025-12-25");
  });

  it("is equivalent to adding seven days per week", () => {
    const viaWeeks = addWeeks(d("2026-03-15"), 5);
    const viaDays = addDays(d("2026-03-15"), 35);
    expect(viaWeeks.getTime()).toBe(viaDays.getTime());
  });

  it("keeps the same weekday", () => {
    // 2026-06-06 is a Saturday; any whole number of weeks later is a Saturday.
    expect(weekday(addWeeks(d("2026-06-06"), 3))).toBe("Sat");
    expect(weekday(addWeeks(d("2026-06-06"), -3))).toBe("Sat");
  });

  it("crosses a month boundary", () => {
    expect(ymd(addWeeks(d("2026-02-25"), 1))).toBe("2026-03-04");
  });

  it("keeps midnight", () => {
    expect(addWeeks(d("2026-03-15"), 1).getHours()).toBe(0);
  });
});

describe("addMonths", () => {
  it("adds a positive number of months keeping the day-of-month", () => {
    expect(ymd(addMonths(d("2026-01-15"), 1))).toBe("2026-02-15");
    expect(ymd(addMonths(d("2026-01-15"), 6))).toBe("2026-07-15");
  });

  it("clamps Jan 31 + 1 month to Feb 28 in 2026", () => {
    // dayjs clamps an overflowing day-of-month to the end of the target month.
    // The engine's monthly cursors depend on this, so it is pinned explicitly.
    expect(ymd(addMonths(d("2026-01-31"), 1))).toBe("2026-02-28");
  });

  it("clamps Jan 31 + 1 month to Feb 29 in leap year 2028", () => {
    expect(ymd(addMonths(d("2028-01-31"), 1))).toBe("2028-02-29");
  });

  it("clamps Jan 30 + 1 month to Feb 28 in 2026", () => {
    expect(ymd(addMonths(d("2026-01-30"), 1))).toBe("2026-02-28");
  });

  it("clamps Mar 31 - 1 month to Feb 28 in 2026", () => {
    expect(ymd(addMonths(d("2026-03-31"), -1))).toBe("2026-02-28");
  });

  it("clamps Mar 31 + 1 month to Apr 30", () => {
    expect(ymd(addMonths(d("2026-03-31"), 1))).toBe("2026-04-30");
  });

  it("does not carry the clamp forward: Jan 31 + 2 months is still Mar 31", () => {
    // Clamping is applied against the original day (31), not against the
    // clamped intermediate value, so the 31st is not lost after February.
    expect(ymd(addMonths(d("2026-01-31"), 2))).toBe("2026-03-31");
  });

  it("is not reversible once a clamp has happened", () => {
    // Jan 31 -> Feb 28 -> Jan 28. Pinned because month cursors that add and
    // subtract months would drift if a caller relied on round-tripping.
    const forward = addMonths(d("2026-01-31"), 1);
    expect(ymd(addMonths(forward, -1))).toBe("2026-01-28");
  });

  it("crosses a year boundary going forward", () => {
    expect(ymd(addMonths(d("2026-11-15"), 3))).toBe("2027-02-15");
    expect(ymd(addMonths(d("2026-12-31"), 1))).toBe("2027-01-31");
  });

  it("crosses a year boundary going backward", () => {
    expect(ymd(addMonths(d("2026-01-15"), -1))).toBe("2025-12-15");
    expect(ymd(addMonths(d("2026-02-15"), -14))).toBe("2024-12-15");
  });

  it("adds twelve months as exactly one year", () => {
    expect(ymd(addMonths(d("2026-03-15"), 12))).toBe("2027-03-15");
  });

  it("keeps midnight", () => {
    const result = addMonths(d("2026-01-31"), 1);
    expect([result.getHours(), result.getMinutes(), result.getMilliseconds()]).toEqual([0, 0, 0]);
  });

  it("preserves a non-midnight time of day through a clamp", () => {
    const result = addMonths(new Date(2026, 0, 31, 9, 30, 0, 0), 1);
    expect(ymd(result)).toBe("2026-02-28");
    expect([result.getHours(), result.getMinutes()]).toEqual([9, 30]);
  });

  it("walks a full year of month cursors from Jan 31 without drifting", () => {
    // How the engine advances a monthly cursor: repeated +1 month from the
    // start date. Once February clamps the cursor to the 28th the day is
    // permanently lost, so this documents the cumulative shape.
    const walked: string[] = [];
    let cursor = d("2026-01-31");
    for (let i = 0; i < 12; i += 1) {
      walked.push(ymd(cursor));
      cursor = addMonths(cursor, 1);
    }
    expect(walked).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-28",
      "2026-04-28",
      "2026-05-28",
      "2026-06-28",
      "2026-07-28",
      "2026-08-28",
      "2026-09-28",
      "2026-10-28",
      "2026-11-28",
      "2026-12-28",
    ]);
  });
});

describe("addYears", () => {
  it("adds a positive number of years keeping month and day", () => {
    expect(ymd(addYears(d("2026-03-15"), 1))).toBe("2027-03-15");
    expect(ymd(addYears(d("2026-03-15"), 10))).toBe("2036-03-15");
  });

  it("subtracts for a negative delta", () => {
    expect(ymd(addYears(d("2026-06-15"), -2))).toBe("2024-06-15");
  });

  it("clamps Feb 29 2028 to Feb 28 2029", () => {
    // 2029 is not a leap year, so dayjs clamps the day to the month end.
    expect(ymd(addYears(d("2028-02-29"), 1))).toBe("2029-02-28");
  });

  it("keeps Feb 29 when landing on the next leap year", () => {
    expect(ymd(addYears(d("2028-02-29"), 4))).toBe("2032-02-29");
  });

  it("clamps Feb 29 2028 to Feb 28 2027 when going backward", () => {
    expect(ymd(addYears(d("2028-02-29"), -1))).toBe("2027-02-28");
  });

  it("keeps midnight", () => {
    expect(addYears(d("2026-03-15"), 1).getHours()).toBe(0);
  });

  it("preserves a non-midnight time of day", () => {
    const result = addYears(new Date(2026, 2, 15, 6, 15, 0, 0), 1);
    expect(ymd(result)).toBe("2027-03-15");
    expect([result.getHours(), result.getMinutes()]).toEqual([6, 15]);
  });
});

describe("date arithmetic purity", () => {
  // Every arithmetic helper must hand back a brand-new Date and leave the
  // caller's Date alone — the engine reuses cursor objects across iterations.
  const cases = [
    { name: "addDays", run: (date: Date) => addDays(date, 5) },
    { name: "addDays (negative)", run: (date: Date) => addDays(date, -5) },
    { name: "addWeeks", run: (date: Date) => addWeeks(date, 2) },
    { name: "addMonths", run: (date: Date) => addMonths(date, 1) },
    { name: "addYears", run: (date: Date) => addYears(date, 1) },
    { name: "startOfDay", run: (date: Date) => startOfDay(date) },
  ] as const;

  it.each(cases)("$name returns a new Date instance", ({ run }) => {
    const input = new Date(2026, 0, 31, 11, 22, 33, 444);
    expect(run(input)).not.toBe(input);
  });

  it.each(cases)("$name does not mutate its input", ({ run }) => {
    expectUnmutated(new Date(2026, 0, 31, 11, 22, 33, 444), "2026-01-31", run);
  });

  it("chained arithmetic does not corrupt the original cursor", () => {
    const cursor = d("2026-01-31");
    const chained = addYears(addMonths(addWeeks(addDays(cursor, 1), 1), 1), 1);
    // 2026-01-31 +1d -> 02-01, +1w -> 02-08, +1mo -> 03-08, +1y -> 2027-03-08.
    expect(ymd(chained)).toBe("2027-03-08");
    expect(ymd(cursor)).toBe("2026-01-31");
  });
});
