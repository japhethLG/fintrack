import { describe, expect, it } from "vitest";
import {
  formatDateByPreference,
  formatDayMonthByPreference,
  formatDayMonthYearByPreference,
  resolveDateFormat,
  resolveStartOfWeek,
  startOfWeekDate,
  weekColumn,
  weekdayLabels,
} from "@/lib/utils/datePreferences";

describe("date format preference (MANUAL-L5)", () => {
  it("prints 3 Oct 2026 in each supported order, zero padded", () => {
    expect(formatDateByPreference("2026-10-03", "MM/DD/YYYY")).toBe("10/03/2026");
    expect(formatDateByPreference("2026-10-03", "DD/MM/YYYY")).toBe("03/10/2026");
    expect(formatDateByPreference("2026-10-03", "YYYY-MM-DD")).toBe("2026-10-03");
  });

  it("an ambiguous day (3 Oct vs 10 Mar) is told apart by the preference", () => {
    expect(formatDateByPreference("2026-03-10", "MM/DD/YYYY")).toBe("03/10/2026");
    expect(formatDateByPreference("2026-03-10", "DD/MM/YYYY")).toBe("10/03/2026");
  });

  it("month-name dates go day first for DD/MM/YYYY and keep the US order otherwise", () => {
    expect(formatDayMonthYearByPreference("2026-10-03", "MM/DD/YYYY")).toBe("Oct 3, 2026");
    expect(formatDayMonthYearByPreference("2026-10-03", "DD/MM/YYYY")).toBe("3 Oct 2026");
    expect(formatDayMonthYearByPreference("2026-10-03", "DD/MM/YYYY", { weekday: true })).toBe(
      "Sat, 3 Oct 2026"
    );
    expect(formatDayMonthByPreference("2026-10-03", "MM/DD/YYYY")).toBe("Oct 3");
    expect(formatDayMonthByPreference("2026-10-03", "DD/MM/YYYY")).toBe("3 Oct");
  });

  it("accepts a Date (local calendar day) as well as a key", () => {
    expect(formatDateByPreference(new Date(2026, 9, 3), "DD/MM/YYYY")).toBe("03/10/2026");
  });

  it("an unknown or missing stored format falls back to the default", () => {
    expect(resolveDateFormat(undefined)).toBe("MM/DD/YYYY");
    expect(resolveDateFormat("D-M-Y")).toBe("MM/DD/YYYY");
    expect(resolveDateFormat("DD/MM/YYYY")).toBe("DD/MM/YYYY");
  });
});

describe("start of week preference (MANUAL-L5)", () => {
  it("weekday headers rotate to start on Monday", () => {
    expect(weekdayLabels(0)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
    expect(weekdayLabels(1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("1 Oct 2026 is a Thursday: column 4 on a Sunday grid, column 3 on a Monday grid", () => {
    const first = new Date(2026, 9, 1);
    expect(first.getDay()).toBe(4);
    expect(weekColumn(first, 0)).toBe(4);
    expect(weekColumn(first, 1)).toBe(3);
  });

  it("a Sunday is the last column of a Monday-first week and the first of a Sunday-first week", () => {
    const sunday = new Date(2026, 9, 4);
    expect(weekColumn(sunday, 0)).toBe(0);
    expect(weekColumn(sunday, 1)).toBe(6);
  });

  it("the week containing Thu 1 Oct starts Sun 27 Sep, or Mon 28 Sep", () => {
    const thursday = new Date(2026, 9, 1);
    expect(startOfWeekDate(thursday, 0)).toEqual(new Date(2026, 8, 27));
    expect(startOfWeekDate(thursday, 1)).toEqual(new Date(2026, 8, 28));
  });

  it("accepts a number or the string the Settings form submits; anything else is Sunday", () => {
    expect(resolveStartOfWeek(1)).toBe(1);
    expect(resolveStartOfWeek("1")).toBe(1);
    expect(resolveStartOfWeek("0")).toBe(0);
    expect(resolveStartOfWeek(undefined)).toBe(0);
    expect(resolveStartOfWeek(7)).toBe(0);
  });
});
