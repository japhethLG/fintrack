import { describe, expect, it } from "vitest";
import {
  buildScheduleConfig,
  cleanSpecificDays,
  describeSchedule,
  getSchedulePreview,
  ordinal,
  startDateParts,
  toWholeNumber,
  validateSchedule,
} from "@/lib/logic/ruleSchedule";
import { formatDate } from "@/lib/utils/dateUtils";

/**
 * The schedule half of the income / expense forms: one config builder, validation, and a preview that IS
 * the projection engine. Expected values are hand-listed from the 2026 calendar
 * (Jan 1 Thu, Feb 1 Sun, Mar 1 Sun, Apr 1 Wed, May 1 Fri), never computed with app code.
 */

const fmt = (dates: Date[]) => dates.map(formatDate);

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [30, "30th"],
    [31, "31st"],
  ])("%i -> %s", (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});

describe("toWholeNumber", () => {
  it("reads whole numbers from numbers and numeric strings only", () => {
    expect(toWholeNumber(31)).toBe(31);
    expect(toWholeNumber("31")).toBe(31);
    expect(toWholeNumber(" 7 ")).toBe(7);
    expect(toWholeNumber(0)).toBe(0);
    for (const bad of ["", "  ", "abc", "1.5", 1.5, NaN, Infinity, null, undefined, {}]) {
      expect(toWholeNumber(bad)).toBeUndefined();
    }
  });
});

describe("startDateParts", () => {
  it("reads the LOCAL day, weekday and month (Sat Jan 31 2026)", () => {
    expect(startDateParts("2026-01-31")).toEqual({ dayOfMonth: 31, dayOfWeek: 6, month: 0 });
  });
  it("is null for blank or unparsable input", () => {
    for (const bad of ["", null, undefined, "not a date", 5]) expect(startDateParts(bad)).toBeNull();
  });
});

describe("buildScheduleConfig: one builder for every frequency", () => {
  const base = { startDate: "2026-03-06" }; // Fri, the 6th, March

  it("one-time and daily persist no schedule values at all (no stray dayOfMonth)", () => {
    expect(buildScheduleConfig({ ...base, frequency: "one-time", dayOfMonth: 15, dayOfWeek: 4 })).toEqual({});
    expect(buildScheduleConfig({ ...base, frequency: "daily", dayOfMonth: 15 })).toEqual({});
  });

  it("weekly: dayOfWeek as a NUMBER, from the form's string, else the start date's weekday (Fri = 5)", () => {
    expect(buildScheduleConfig({ ...base, frequency: "weekly", dayOfWeek: "1" })).toEqual({ dayOfWeek: 1 });
    expect(buildScheduleConfig({ ...base, frequency: "weekly", dayOfWeek: 0 })).toEqual({ dayOfWeek: 0 });
    expect(buildScheduleConfig({ ...base, frequency: "weekly" })).toEqual({ dayOfWeek: 5 });
    expect(buildScheduleConfig({ ...base, frequency: "weekly", dayOfWeek: "" })).toEqual({ dayOfWeek: 5 });
    expect(buildScheduleConfig({ ...base, frequency: "weekly", dayOfWeek: 9 })).toEqual({ dayOfWeek: 5 });
  });

  it("bi-weekly: dayOfWeek plus intervalWeeks (default 2, a stored interval is kept)", () => {
    expect(buildScheduleConfig({ ...base, frequency: "bi-weekly" })).toEqual({ dayOfWeek: 5, intervalWeeks: 2 });
    expect(buildScheduleConfig({ ...base, frequency: "bi-weekly", intervalWeeks: 3 })).toEqual({
      dayOfWeek: 5,
      intervalWeeks: 3,
    });
    expect(buildScheduleConfig({ ...base, frequency: "bi-weekly", intervalWeeks: 0 })).toEqual({
      dayOfWeek: 5,
      intervalWeeks: 2,
    });
  });

  it("semi-monthly: the days, cleaned (sorted, unique, 1..31, numbers)", () => {
    expect(buildScheduleConfig({ ...base, frequency: "semi-monthly", specificDays: [30, "15", 15, 0, 32, 1.5] })).toEqual({
      specificDays: [15, 30],
    });
    expect(buildScheduleConfig({ ...base, frequency: "semi-monthly", specificDays: [] })).toEqual({ specificDays: [] });
  });

  it("monthly: dayOfMonth as a NUMBER (the string '31' is 31), else the start date's day (6)", () => {
    expect(buildScheduleConfig({ ...base, frequency: "monthly", dayOfMonth: "31" })).toEqual({ dayOfMonth: 31 });
    expect(buildScheduleConfig({ ...base, frequency: "monthly", dayOfMonth: 15 })).toEqual({ dayOfMonth: 15 });
    expect(buildScheduleConfig({ ...base, frequency: "monthly" })).toEqual({ dayOfMonth: 6 });
    expect(buildScheduleConfig({ ...base, frequency: "monthly", dayOfMonth: "" })).toEqual({ dayOfMonth: 6 });
    expect(buildScheduleConfig({ ...base, frequency: "monthly", dayOfMonth: 40 })).toEqual({ dayOfMonth: 6 });
  });

  it("quarterly and yearly: dayOfMonth AND monthOfYear (March = 2) from the start date (the expense form used to write {})", () => {
    for (const frequency of ["quarterly", "yearly"] as const) {
      expect(buildScheduleConfig({ ...base, frequency })).toEqual({ dayOfMonth: 6, monthOfYear: 2 });
    }
    expect(buildScheduleConfig({ startDate: "2026-01-31", frequency: "quarterly" })).toEqual({
      dayOfMonth: 31,
      monthOfYear: 0, // January is a real value, not "absent"
    });
  });

  it("a stored monthOfYear is kept over the start date's month", () => {
    expect(buildScheduleConfig({ ...base, frequency: "yearly", monthOfYear: 5 })).toEqual({
      dayOfMonth: 6,
      monthOfYear: 5,
    });
  });
});

describe("cleanSpecificDays", () => {
  it("sorts, de-duplicates and drops anything outside 1..31", () => {
    expect(cleanSpecificDays([20, 5, 20, "9", 0, 32, -1])).toEqual([5, 9, 20]);
    expect(cleanSpecificDays(undefined)).toEqual([]);
  });
});

describe("validateSchedule", () => {
  const ok = { frequency: "monthly" as const, startDate: "2026-03-01" };

  it("a valid schedule has no issues", () => {
    expect(validateSchedule(ok)).toEqual([]);
    expect(validateSchedule({ ...ok, hasEndDate: true, endDate: "2026-03-01" })).toEqual([]); // end == start is fine
  });

  it("an end date before the start date is an issue on endDate", () => {
    expect(validateSchedule({ ...ok, hasEndDate: true, endDate: "2026-02-28" })).toEqual([
      { field: "endDate", message: "The end date must be on or after the start date." },
    ]);
  });

  it("an end date is ignored when 'Set End Date' is not ticked, and a ticked box with no date is fine", () => {
    expect(validateSchedule({ ...ok, hasEndDate: false, endDate: "2026-02-01" })).toEqual([]);
    expect(validateSchedule({ ...ok, hasEndDate: true, endDate: "" })).toEqual([]);
  });

  it("semi-monthly with no usable day is an issue", () => {
    expect(validateSchedule({ frequency: "semi-monthly", startDate: "2026-03-01", specificDays: [] })).toEqual([
      { field: "specificDays", message: "Add at least one day of the month for a semi-monthly schedule." },
    ]);
    expect(validateSchedule({ frequency: "semi-monthly", startDate: "2026-03-01", specificDays: [15] })).toEqual([]);
  });

  it("a blank or missing start date is an issue", () => {
    expect(validateSchedule({ frequency: "monthly", startDate: "" }).map((i) => i.field)).toEqual(["startDate"]);
    expect(validateSchedule({ frequency: "monthly", startDate: null }).map((i) => i.field)).toEqual(["startDate"]);
  });

  it("a day of month outside 1..31 (or fractional) is an issue; blank falls back to the start date", () => {
    for (const bad of [0, 32, -5, "45", 1.5]) {
      expect(validateSchedule({ ...ok, dayOfMonth: bad }).map((i) => i.field)).toEqual(["dayOfMonth"]);
    }
    for (const fine of ["", undefined, null, 1, "31"]) expect(validateSchedule({ ...ok, dayOfMonth: fine })).toEqual([]);
    // irrelevant for a weekly schedule
    expect(validateSchedule({ frequency: "weekly", startDate: "2026-03-01", dayOfMonth: 99 })).toEqual([]);
  });
});

describe("getSchedulePreview uses the real engine", () => {
  const preview = (over: Partial<Parameters<typeof getSchedulePreview>[0]> & { frequency: Parameters<typeof getSchedulePreview>[0]["frequency"] }) =>
    getSchedulePreview({
      startDate: "2026-02-02",
      weekendAdjustment: "none",
      scheduleConfig: {},
      hasEndDate: false,
      ...over,
    });

  it("weekly on Friday from Mon Feb 2: Fridays, through start + 3 months (May 2)", () => {
    const { dates } = preview({ frequency: "weekly", scheduleConfig: { dayOfWeek: 5 } });
    expect(fmt(dates)).toEqual([
      "2026-02-06", "2026-02-13", "2026-02-20", "2026-02-27",
      "2026-03-06", "2026-03-13", "2026-03-20", "2026-03-27",
      "2026-04-03", "2026-04-10", "2026-04-17", "2026-04-24", "2026-05-01",
    ]); // prettier-ignore
  });

  it("semi-monthly [15, 30] clamps the 30th to Feb 28 (horizon Apr 1)", () => {
    const { dates } = preview({
      frequency: "semi-monthly",
      startDate: "2026-01-01",
      scheduleConfig: { specificDays: [15, 30] },
    });
    expect(fmt(dates)).toEqual(["2026-01-15", "2026-01-30", "2026-02-15", "2026-02-28", "2026-03-15", "2026-03-30"]);
  });

  it("quarterly from Jan 31 clamps month ends: Jan 31, Apr 30, Jul 31, Oct 31 (an end date extends the horizon)", () => {
    const { dates } = preview({
      frequency: "quarterly",
      startDate: "2026-01-31",
      hasEndDate: true,
      endDate: "2026-12-31",
      scheduleConfig: { dayOfMonth: 31, monthOfYear: 0 },
    });
    expect(fmt(dates)).toEqual(["2026-01-31", "2026-04-30", "2026-07-31", "2026-10-31"]);
  });

  it("yearly from Feb 29 2028 keeps Feb 28 in non-leap years", () => {
    const { dates } = preview({
      frequency: "yearly",
      startDate: "2028-02-29",
      hasEndDate: true,
      endDate: "2032-12-31",
      scheduleConfig: { dayOfMonth: 29, monthOfYear: 1 },
    });
    expect(fmt(dates)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
  });

  it("weekend adjustment: monthly on the 15th 'before' from Jan 1 -> Jan 15, Fri Feb 13, Fri Mar 13 (Sundays move)", () => {
    const { dates } = preview({
      frequency: "monthly",
      startDate: "2026-01-01",
      weekendAdjustment: "before",
      scheduleConfig: { dayOfMonth: 15 },
    });
    expect(fmt(dates)).toEqual(["2026-01-15", "2026-02-13", "2026-03-13"]);
  });

  it("a 'before' first payment lands ahead of the start date and is shown (Sun Mar 1 -> Fri Feb 27)", () => {
    const { dates } = preview({
      frequency: "monthly",
      startDate: "2026-03-01",
      weekendAdjustment: "before",
      scheduleConfig: { dayOfMonth: 1 },
    });
    expect(fmt(dates)).toEqual(["2026-02-27", "2026-04-01", "2026-05-01", "2026-06-01"]);
  });

  it("an 'after' last payment past the end date is shown (Sat Feb 21 end -> Mon Feb 23)", () => {
    const { dates } = preview({
      frequency: "weekly",
      startDate: "2026-02-07",
      hasEndDate: true,
      endDate: "2026-02-21",
      weekendAdjustment: "after",
      scheduleConfig: { dayOfWeek: 6 },
    });
    expect(fmt(dates)).toEqual(["2026-02-09", "2026-02-16", "2026-02-23"]);
  });

  it("daily ignores weekend adjustment: five consecutive days, no duplicates (UI-RULE-13)", () => {
    const { dates } = preview({
      frequency: "daily",
      startDate: "2026-02-06",
      hasEndDate: true,
      endDate: "2026-02-10",
      weekendAdjustment: "before",
    });
    expect(fmt(dates)).toEqual(["2026-02-06", "2026-02-07", "2026-02-08", "2026-02-09", "2026-02-10"]);
  });

  it("an end date before the start date previews nothing", () => {
    expect(
      preview({ frequency: "monthly", startDate: "2026-03-01", hasEndDate: true, endDate: "2026-02-01", scheduleConfig: { dayOfMonth: 1 } }).dates
    ).toEqual([]);
  });

  it("maxOccurrences caps a fixed-length plan (a 2-payment loan previews 2 dates)", () => {
    const { dates } = preview({
      frequency: "monthly",
      startDate: "2026-02-10",
      scheduleConfig: { dayOfMonth: 10 },
      maxOccurrences: 2,
    });
    expect(fmt(dates)).toEqual(["2026-02-10", "2026-03-10"]);
  });

  it("an unparsable start date previews nothing", () => {
    expect(preview({ frequency: "monthly", startDate: "" }).dates).toEqual([]);
  });
});

describe("describeSchedule", () => {
  const fb = "fallback";
  it("reads missing values the way the engine does: from the start date", () => {
    // start Mon Feb 2 2026
    expect(describeSchedule("weekly", {}, "2026-02-02", fb)).toBe("Every Monday");
    expect(describeSchedule("bi-weekly", {}, "2026-02-02", fb)).toBe("Every 2 weeks on Monday");
    expect(describeSchedule("monthly", {}, "2026-02-02", fb)).toBe("On the 2nd of each month");
  });
  it("uses the stored values", () => {
    expect(describeSchedule("weekly", { dayOfWeek: 5 }, "2026-02-02", fb)).toBe("Every Friday");
    expect(describeSchedule("bi-weekly", { dayOfWeek: 5, intervalWeeks: 3 }, "2026-02-02", fb)).toBe("Every 3 weeks on Friday");
    expect(describeSchedule("monthly", { dayOfMonth: 31 }, "2026-02-02", fb)).toBe("On the 31st of each month");
    expect(describeSchedule("semi-monthly", { specificDays: [1, 15] }, "2026-02-02", fb)).toBe(
      "On the 1st and 15th of each month"
    );
  });
  it("other frequencies return the fallback label", () => {
    expect(describeSchedule("quarterly", {}, "2026-02-02", "Quarterly")).toBe("Quarterly");
    expect(describeSchedule("one-time", undefined, "2026-02-02", "One-time")).toBe("One-time");
  });
});
