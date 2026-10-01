/**
 * Frequency Utilities
 *
 * TYPICAL-MONTH helpers. No displayed total uses them: every figure on the Dashboard, Calendar,
 * Forecast and the Income/Expense managers is counted from the occurrences the schedule really
 * produces (see app/lib/logic/forecasting/recurringTotals.ts), so a five-Friday month is five
 * payments. Use these only for a figure that is genuinely "a typical month" and label it so.
 */

import { IncomeFrequency } from "@/lib/types";
import {
  civilFromDayNumber,
  dayNumberOfDate,
  parseDate,
  toDayNumber,
} from "@/lib/utils/dateUtils";

/**
 * Get the multiplier to convert a frequency amount to a typical month (365 days / 12 months)
 * @param frequency - The payment frequency
 * @returns Multiplier to convert to a typical month (e.g., weekly * 52/12 = monthly)
 */
export const getMonthlyMultiplier = (frequency: IncomeFrequency): number => {
  switch (frequency) {
    case "daily":
      return 365 / 12; // ~30.417: a year has 365 days, not 360
    case "weekly":
      return 52 / 12; // ~4.333
    case "bi-weekly":
      return 26 / 12; // ~2.167
    case "semi-monthly":
      return 2;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "yearly":
      return 1 / 12;
    case "one-time":
    default:
      return 0;
  }
};

/** Days in the calendar month a day number falls in. */
const daysInMonthOf = (dayNumber: number): number => {
  const { year, month } = civilFromDayNumber(dayNumber);
  return toDayNumber(year, month + 1, 1) - toDayNumber(year, month, 1);
};

/**
 * Calculate the share of a monthly amount that falls in a date range: each day of the range is
 * worth `monthlyAmount / (days in THAT calendar month)`, so a whole month is exactly
 * `monthlyAmount` whether it has 28, 30 or 31 days (no fixed 30-day divisor).
 * @param monthlyAmount - The monthly amount
 * @param startDate - Range start date (YYYY-MM-DD)
 * @param endDate - Range end date (YYYY-MM-DD), inclusive
 * @returns The amount for the date range (negative for an inverted range, not validated)
 */
export const prorateToDateRange = (
  monthlyAmount: number,
  startDate: string,
  endDate: string
): number => {
  // Whole local calendar days (day numbers: no UTC parsing, no DST skew).
  const first = dayNumberOfDate(parseDate(startDate));
  const last = dayNumberOfDate(parseDate(endDate));
  if (last < first) {
    // Inverted range: no validation, a negative count of days at the start month's daily rate.
    return ((last - first + 1) * monthlyAmount) / daysInMonthOf(first);
  }
  let total = 0;
  for (let day = first; day <= last; day++) total += monthlyAmount / daysInMonthOf(day);
  return total;
};
