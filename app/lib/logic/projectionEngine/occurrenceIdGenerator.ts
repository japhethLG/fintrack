/**
 * Generates stable occurrence identifiers for recurring transactions.
 * The ID represents the logical recurrence period (e.g., "rent_2025-01")
 * so it remains stable even if the scheduled date shifts (weekend adjust,
 * user drag/drop, or rule date changes).
 *
 * IDENTITY COMES FROM THE LOGICAL DATE. Callers must pass the occurrence's
 * nominal due date (`Occurrence.logicalDate` from `calculateOccurrencesDetailed`),
 * never the weekend-adjusted date and never an override's `scheduledDate`.
 * Feeding the adjusted date moves an occurrence into the neighbouring
 * month/week/quarter/year namespace (Sun 2026-03-01 "before" -> Fri 2026-02-27
 * was labelled February) and lets two occurrences share one id.
 *
 * The id FORMATS are unchanged from earlier versions, so ids stored before this
 * change keep matching whenever the old date happened to be the logical date.
 */

import { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { formatDate, parseDate } from "@/lib/utils/dateUtils";
import {
  civilFromDayNumber,
  clampDayToMonth,
  dayNumberOfDate,
  resolveIntervalWeeks,
  resolveSpecificDays,
  toDayNumber,
  weekdayOfDayNumber,
} from "./dateUtils";

const pad = (value: number, size = 2) => value.toString().padStart(size, "0");

/** ISO-8601 week number and week-year of a day number (the Thursday of a week decides its year). */
const getISOWeekInfo = (n: number): { year: number; week: number } => {
  const thursday = n + 3 - ((weekdayOfDayNumber(n) + 6) % 7);
  const year = civilFromDayNumber(thursday).year;
  const week = Math.floor((thursday - toDayNumber(year, 0, 1)) / 7) + 1;
  return { year, week };
};

/**
 * 1-based interval index counted in WHOLE CALENDAR DAYS from the rule's start
 * date, so a DST change inside the span cannot shift (or merge) an index.
 */
const getBiWeeklyIndex = (startN: number, currentN: number, intervalWeeks: number): number =>
  Math.floor((currentN - startN) / (intervalWeeks * 7)) + 1;

/**
 * 1-based slot of an occurrence: its index in the sorted, de-duplicated
 * `specificDays`. The occurrence's logical day is the (month-clamped) slot day,
 * so it is found by clamping each slot day to the month and matching. Slots that
 * clamp to the same day resolve to the first, matching the calculator, which
 * emits such a pair once. A day that matches no slot falls back to the nearest one.
 */
const getSemiMonthlySlot = (
  year: number,
  month: number,
  day: number,
  config: ScheduleConfig
): number => {
  const days = resolveSpecificDays(config);
  if (days.length === 0) return 1;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < days.length; i++) {
    const distance = Math.abs(clampDayToMonth(days[i], year, month) - day);
    if (distance === 0) return i + 1;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best + 1;
};

/**
 * Generate a stable occurrence identifier for a projected transaction.
 *
 * @param logicalDate - the occurrence's LOGICAL (nominal) date, not the weekend-adjusted one
 */
export const generateOccurrenceId = (
  sourceId: string,
  frequency: IncomeFrequency,
  logicalDate: Date,
  startDate: string,
  scheduleConfig: ScheduleConfig = {}
): string => {
  const n = dayNumberOfDate(logicalDate);
  const { year, month: monthIndex, day } = civilFromDayNumber(n);
  const month = pad(monthIndex + 1);

  switch (frequency) {
    case "one-time":
      return `${sourceId}_once`;

    case "daily":
      return `${sourceId}_${year}-${month}-${pad(day)}`;

    case "weekly": {
      const { year: weekYear, week } = getISOWeekInfo(n);
      return `${sourceId}_${weekYear}-W${pad(week)}`;
    }

    case "bi-weekly": {
      const interval = resolveIntervalWeeks(scheduleConfig);
      const occurrenceNumber = getBiWeeklyIndex(dayNumberOfDate(parseDate(startDate)), n, interval);
      return `${sourceId}_BW${occurrenceNumber}`;
    }

    case "semi-monthly": {
      const slot = getSemiMonthlySlot(year, monthIndex, day, scheduleConfig);
      return `${sourceId}_${year}-${month}-${slot}`;
    }

    case "monthly":
      return `${sourceId}_${year}-${month}`;

    case "quarterly": {
      const quarter = Math.floor(monthIndex / 3) + 1;
      return `${sourceId}_${year}-Q${quarter}`;
    }

    case "yearly":
      return `${sourceId}_${year}`;

    default:
      // Fallback for unexpected frequencies
      return `${sourceId}_${formatDate(logicalDate)}`;
  }
};
