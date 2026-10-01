/**
 * Date utility functions for projection calculations
 *
 * Date-based helpers (`adjustForWeekend`, `clampDayToMonth`, ...) work on
 * local-midnight `Date`s. The occurrence pipeline itself iterates and compares on
 * integer "day numbers" (see `@/lib/utils/dateUtils`, re-exported below), which
 * have no wall-clock, DST or time-zone component.
 */

import { addDays, addMonths, formatDate, weekdayOfDayNumber } from "@/lib/utils/dateUtils";
import type { ScheduleConfig } from "@/lib/types";

export {
  toDayNumber,
  dayNumberOfDate,
  civilFromDayNumber,
  dateFromDayNumber,
  weekdayOfDayNumber,
  monthIndexOfDayNumber,
} from "@/lib/utils/dateUtils";

// ============================================================================
// Weekend adjustment
// ============================================================================

export type WeekendAdjustment = "before" | "after" | "none";

/**
 * Check if a date falls on a weekend
 */
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

/**
 * Day-number form of `adjustForWeekend`: Saturday/Sunday move to the preceding
 * Friday ("before") or following Monday ("after"). Anything other than
 * "before"/"after" leaves the day alone.
 */
export const adjustDayNumberForWeekend = (n: number, adjustment: WeekendAdjustment): number => {
  if (adjustment !== "before" && adjustment !== "after") return n;
  const weekday = weekdayOfDayNumber(n);
  if (weekday === 0) return adjustment === "before" ? n - 2 : n + 1; // Sunday
  if (weekday === 6) return adjustment === "before" ? n - 1 : n + 2; // Saturday
  return n;
};

/** The furthest a weekend adjustment can move a date, in days (Sunday -> Friday). */
export const MAX_WEEKEND_SHIFT_DAYS = 2;

/**
 * Adjust a date if it falls on a weekend
 * @param date - Date to adjust
 * @param adjustment - How to adjust: "before" (to Friday), "after" (to Monday), or "none"
 */
export const adjustForWeekend = (date: Date, adjustment: WeekendAdjustment): Date => {
  if (adjustment === "none") return date;

  const day = date.getDay();
  if (day === 0) {
    // Sunday
    return adjustment === "before" ? addDays(date, -2) : addDays(date, 1);
  }
  if (day === 6) {
    // Saturday
    return adjustment === "before" ? addDays(date, -1) : addDays(date, 2);
  }
  return date;
};

// ============================================================================
// Month arithmetic
// ============================================================================

/**
 * Get the last day of a given month
 */
export const getLastDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

/**
 * Clamp a day number to be valid for a given month
 * (e.g., day 31 in February becomes day 28/29, and a day below 1 becomes 1).
 *
 * The lower bound matters: `new Date(y, m, 0)` is the LAST day of the previous
 * month, so an unclamped 0 silently moves an occurrence into the wrong month.
 * A non-finite day (NaN) is treated as day 1.
 */
export const clampDayToMonth = (day: number, year: number, month: number): number => {
  if (!Number.isFinite(day)) return 1;
  const maxDay = getLastDayOfMonth(year, month);
  return Math.max(1, Math.min(day, maxDay));
};

/**
 * Due date of the `index`-th (0-based) payment of a MONTHLY debt schedule (loan, installment plan).
 *
 * With a usable `dayOfMonth` (an integer 1..31) the payments fall on that day of each month, clamped to
 * short months from the fixed day rather than from the previous result (a 31st is Jan 31, Feb 28, Mar 31).
 * The first payment is that day in the start date's month, or the next month's when it has already
 * passed (start Feb 10, day 5: Mar 5), the same rule as a monthly recurring rule and as the credit card
 * generator. Without one the payments follow the start date's own day (`addMonths` from the anchor).
 */
export const monthlyPaymentDate = (anchor: Date, dayOfMonth: unknown, index: number): Date => {
  const day = toInteger(dayOfMonth);
  if (day === null || day < 1 || day > 31) return addMonths(anchor, index);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const startMonthIndex = year * 12 + month;
  const firstMonthIndex =
    clampDayToMonth(day, year, month) >= anchor.getDate() ? startMonthIndex : startMonthIndex + 1;
  const monthIndex = firstMonthIndex + index;
  const y = Math.floor(monthIndex / 12);
  const m = monthIndex % 12;
  return new Date(y, m, clampDayToMonth(day, y, m));
};

// ============================================================================
// View windows
// ============================================================================

/**
 * Membership test for a view window on `YYYY-MM-DD` strings. Generators apply it to the
 * date a row is SHOWN on (an override's `scheduledDate` when it has one), so a dragged
 * row belongs to the window it was dropped in.
 */
export const windowFilter = (viewStartDate: Date, viewEndDate: Date) => {
  const start = formatDate(viewStartDate);
  const end = formatDate(viewEndDate);
  return (ymd: string): boolean => ymd >= start && ymd <= end;
};

/** Sort comparator: chronological by `scheduledDate` (YYYY-MM-DD strings order as dates). */
export const byScheduledDate = (a: { scheduledDate: string }, b: { scheduledDate: string }): number =>
  a.scheduledDate < b.scheduledDate ? -1 : a.scheduledDate > b.scheduledDate ? 1 : 0;

// ============================================================================
// ScheduleConfig sanitising (shared by the calculator and the id generator so
// both always agree on what a rule's configuration means)
// ============================================================================

/** An integer from a number or numeric string; `null` for anything else (incl. null/undefined/NaN). */
export const toInteger = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
};

/** `intervalWeeks` as an integer >= 1; anything else (0, negative, NaN, absent) means the default of 2. */
export const resolveIntervalWeeks = (config: ScheduleConfig | undefined): number => {
  const n = toInteger(config?.intervalWeeks);
  return n !== null && n >= 1 ? n : 2;
};

/** `dayOfWeek` as 0..6, or `null` when absent/invalid (no alignment: the start date's weekday rules). */
export const resolveDayOfWeek = (config: ScheduleConfig | undefined): number | null => {
  const n = toInteger(config?.dayOfWeek);
  return n !== null && n >= 0 && n <= 6 ? n : null;
};

/**
 * The semi-monthly days of the month: sorted ascending and de-duplicated, so a
 * slot's identity is its index in this list regardless of how the user typed
 * them. Missing config means the [15, 30] default; an explicit empty list means
 * "no dates".
 */
export const resolveSpecificDays = (config: ScheduleConfig | undefined): number[] => {
  const raw = config?.specificDays ?? [15, 30];
  if (!Array.isArray(raw)) return [15, 30];
  const days = raw.map(toInteger).filter((n): n is number => n !== null);
  return Array.from(new Set(days)).sort((a, b) => a - b);
};
