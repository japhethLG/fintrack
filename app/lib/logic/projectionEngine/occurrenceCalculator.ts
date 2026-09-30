/**
 * Calculate occurrence dates for recurring schedules.
 *
 * The calculator is a four-stage pipeline (see docs/audit/fixes/engine-dates.md):
 *
 *   1. GENERATE  candidate LOGICAL dates on the period axis (month index, year,
 *                week index, day index), bounded by the rule's own
 *                startDate/endDate. A logical date is "the day this occurrence
 *                is nominally due" and is what identity (occurrence ids) hangs on.
 *   2. ADJUST    each logical date for weekends ("before" -> Friday, "after" -> Monday).
 *   3. DEDUPE    by logical date (two slots that clamp to the same day, e.g.
 *                [30, 31] in February, are one occurrence).
 *   4. FILTER    on the ADJUSTED date to the view window, with both bounds
 *                normalised to whole calendar days.
 *
 * Stage 1 therefore reads a little outside the window (by the maximum weekend
 * shift) so that an occurrence whose logical date is just outside the window but
 * whose adjusted date lands inside it is found, and vice versa. That makes the
 * output composable: the union of two adjacent windows equals the window that
 * spans both.
 *
 * All arithmetic is on integer day numbers (see ./dateUtils), so nothing here
 * depends on the time zone, DST, or the wall-clock time of the input Dates.
 */

import { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { parseDate } from "@/lib/utils/dateUtils";
import {
  MAX_WEEKEND_SHIFT_DAYS,
  WeekendAdjustment,
  adjustDayNumberForWeekend,
  civilFromDayNumber,
  clampDayToMonth,
  dateFromDayNumber,
  dayNumberOfDate,
  monthIndexOfDayNumber,
  resolveDayOfWeek,
  resolveIntervalWeeks,
  resolveSpecificDays,
  toDayNumber,
  toInteger,
  weekdayOfDayNumber,
} from "./dateUtils";

interface OccurrenceParams {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;
  scheduleConfig: ScheduleConfig;
  weekendAdjustment: WeekendAdjustment;
}

/** One occurrence: the day it is nominally due, and the day it actually lands on. */
export interface Occurrence {
  /** Nominal due date on the rule's period axis. Identity (occurrence ids) is derived from this. */
  logicalDate: Date;
  /** The date after weekend adjustment; what the user sees and what windows filter on. */
  date: Date;
}

/** Output ceiling: a single rule never yields more than this many occurrences in one call. */
const MAX_OCCURRENCES = 500;
/** Loop ceiling for each generator, counting ITERATIONS (not output), so no input can hang the tab. */
const MAX_ITERATIONS = 20_000;

const FREQUENCIES: readonly IncomeFrequency[] = [
  "one-time",
  "daily",
  "weekly",
  "bi-weekly",
  "semi-monthly",
  "monthly",
  "quarterly",
  "yearly",
];

// ----------------------------------------------------------------------------
// Stage 1: logical-date generators. Each yields ascending day numbers in [lo, hi].
// ----------------------------------------------------------------------------

interface Anchor {
  /** Day number of the rule's startDate. */
  n: number;
  year: number;
  month: number;
  day: number;
}

/** Day-of-month for monthly/quarterly/yearly: the configured one, else the start date's day. */
const resolveDayOfMonth = (config: ScheduleConfig, anchor: Anchor): number =>
  toInteger(config.dayOfMonth) ?? anchor.day;

function* stepByDays(anchor: Anchor, step: number, config: ScheduleConfig, lo: number, hi: number) {
  // First occurrence: the start date, or the first configured weekday on/after it.
  const dayOfWeek = resolveDayOfWeek(config);
  let n =
    dayOfWeek === null ? anchor.n : anchor.n + ((dayOfWeek - weekdayOfDayNumber(anchor.n) + 7) % 7);
  // Jump straight to the window instead of walking from the rule's start.
  if (n < lo) n += Math.ceil((lo - n) / step) * step;
  for (let i = 0; n <= hi && i < MAX_ITERATIONS; i++, n += step) yield n;
}

function* generateLogicalDates(
  frequency: IncomeFrequency,
  anchor: Anchor,
  config: ScheduleConfig,
  lo: number,
  hi: number
): Generator<number> {
  switch (frequency) {
    case "one-time": {
      if (anchor.n >= lo && anchor.n <= hi) yield anchor.n;
      return;
    }

    case "daily": {
      for (let n = lo, i = 0; n <= hi && i < MAX_ITERATIONS; n++, i++) yield n;
      return;
    }

    case "weekly": {
      yield* stepByDays(anchor, 7, config, lo, hi);
      return;
    }

    case "bi-weekly": {
      yield* stepByDays(anchor, 7 * resolveIntervalWeeks(config), config, lo, hi);
      return;
    }

    case "semi-monthly": {
      const days = resolveSpecificDays(config);
      const lastMonth = monthIndexOfDayNumber(hi);
      let iterations = 0;
      for (let idx = monthIndexOfDayNumber(lo); idx <= lastMonth; idx++) {
        if (++iterations > MAX_ITERATIONS) return;
        const year = Math.floor(idx / 12);
        const month = idx % 12;
        let previous = -Infinity;
        for (const day of days) {
          const n = toDayNumber(year, month, clampDayToMonth(day, year, month));
          // Stage 3 for this frequency: slots that clamp to the same day are one occurrence.
          if (n === previous) continue;
          previous = n;
          if (n >= lo && n <= hi) yield n;
        }
      }
      return;
    }

    case "monthly": {
      const dayOfMonth = resolveDayOfMonth(config, anchor);
      const lastMonth = monthIndexOfDayNumber(hi);
      let iterations = 0;
      for (let idx = monthIndexOfDayNumber(lo); idx <= lastMonth; idx++) {
        if (++iterations > MAX_ITERATIONS) return;
        const year = Math.floor(idx / 12);
        const month = idx % 12;
        const n = toDayNumber(year, month, clampDayToMonth(dayOfMonth, year, month));
        if (n >= lo && n <= hi) yield n;
      }
      return;
    }

    case "quarterly": {
      const dayOfMonth = resolveDayOfMonth(config, anchor);
      const anchorIdx = anchor.year * 12 + anchor.month;
      const lastMonth = monthIndexOfDayNumber(hi);
      // Quarters are anchored to the start date's month: start month + 3k.
      const firstK = Math.max(0, Math.floor((monthIndexOfDayNumber(lo) - anchorIdx) / 3));
      for (let k = firstK, i = 0; i < MAX_ITERATIONS; k++, i++) {
        const idx = anchorIdx + 3 * k;
        if (idx > lastMonth) return;
        const year = Math.floor(idx / 12);
        const month = idx % 12;
        const n = toDayNumber(year, month, clampDayToMonth(dayOfMonth, year, month));
        if (n >= lo && n <= hi) yield n;
      }
      return;
    }

    case "yearly": {
      const configured = toInteger(config.monthOfYear);
      // `??`-style fallback: 0 (January) is a real month. Out-of-range months fall back to the start month.
      const month =
        configured !== null && configured >= 0 && configured <= 11 ? configured : anchor.month;
      const dayOfMonth = resolveDayOfMonth(config, anchor);
      const lastYear = civilFromDayNumber(hi).year;
      for (
        let year = civilFromDayNumber(lo).year, i = 0;
        year <= lastYear && i < MAX_ITERATIONS;
        year++, i++
      ) {
        const n = toDayNumber(year, month, clampDayToMonth(dayOfMonth, year, month));
        if (n >= lo && n <= hi) yield n;
      }
      return;
    }

    default:
      // Unknown frequencies are rejected before generation (see calculateOccurrencesDetailed).
      return;
  }
}

// ----------------------------------------------------------------------------
// The pipeline
// ----------------------------------------------------------------------------

/**
 * Calculate all occurrences of a recurring schedule within a date range, keeping
 * both the logical date (identity) and the adjusted date (what the user sees).
 *
 * @param params - Schedule parameters
 * @param viewStartDate - First day of the viewing period (inclusive; time of day ignored)
 * @param viewEndDate - Last day of the viewing period (inclusive; time of day ignored)
 * @returns Occurrences in ascending date order, at most 500
 */
export const calculateOccurrencesDetailed = (
  params: OccurrenceParams,
  viewStartDate: Date,
  viewEndDate: Date
): Occurrence[] => {
  // An unrecognised frequency is a data/programming error: surface it even when the window is empty.
  if (!FREQUENCIES.includes(params.frequency)) {
    const message = `Unknown frequency "${String(params.frequency)}" (expected one of ${FREQUENCIES.join(", ")})`;
    if (process.env.NODE_ENV === "production") {
      console.warn(`[calculateOccurrences] ${message}; the rule produces no occurrences.`);
      return [];
    }
    throw new Error(message);
  }

  const start = parseDate(params.startDate);
  const startN = dayNumberOfDate(start);
  const windowStart = dayNumberOfDate(viewStartDate);
  const windowEnd = dayNumberOfDate(viewEndDate);
  if (!Number.isFinite(startN) || !Number.isFinite(windowStart) || !Number.isFinite(windowEnd)) {
    return [];
  }

  // Safety check: ensure scheduleConfig is defined
  const scheduleConfig = params.scheduleConfig || {};

  // The rule's own end date bounds the LOGICAL dates. An unparsable end date is ignored.
  const endN = params.endDate ? dayNumberOfDate(parseDate(params.endDate)) : NaN;
  const ruleEnd = Number.isFinite(endN) ? endN : Infinity;

  // Stage 1 reads MAX_WEEKEND_SHIFT_DAYS beyond the window on each side so that dates which
  // the weekend adjustment moves INTO the window are found.
  const lo = Math.max(startN, windowStart - MAX_WEEKEND_SHIFT_DAYS);
  const hi = Math.min(ruleEnd, windowEnd + MAX_WEEKEND_SHIFT_DAYS);
  if (lo > hi) return [];

  // A daily rule has an occurrence EVERY day, so "move a weekend payday to Friday/Monday" has no
  // meaning for it: applying it stacked Sat+Sun+Mon on one Monday (or dropped two of them).
  // Daily rules therefore ignore weekend adjustment.
  const adjustment: WeekendAdjustment =
    params.frequency !== "daily" &&
    (params.weekendAdjustment === "before" || params.weekendAdjustment === "after")
      ? params.weekendAdjustment
      : "none";

  const anchorParts = civilFromDayNumber(startN);
  const anchor: Anchor = { n: startN, ...anchorParts };

  const occurrences: Occurrence[] = [];
  for (const logical of generateLogicalDates(params.frequency, anchor, scheduleConfig, lo, hi)) {
    const adjusted = adjustDayNumberForWeekend(logical, adjustment);
    // Stage 4: the window applies to where the occurrence LANDS.
    if (adjusted < windowStart || adjusted > windowEnd) continue;
    occurrences.push({
      logicalDate: dateFromDayNumber(logical),
      date: dateFromDayNumber(adjusted),
    });
    if (occurrences.length >= MAX_OCCURRENCES) break;
  }

  // Logical dates ascend, and weekend adjustment is monotonic, so this is already sorted.
  return occurrences;
};

/**
 * Calculate all occurrence dates for a recurring schedule within a date range.
 * A thin wrapper over `calculateOccurrencesDetailed` for callers that only need dates.
 * @param params - Schedule parameters
 * @param viewStartDate - Start of viewing period
 * @param viewEndDate - End of viewing period
 * @returns Array of (weekend-adjusted) occurrence dates
 */
export const calculateOccurrences = (
  params: OccurrenceParams,
  viewStartDate: Date,
  viewEndDate: Date
): Date[] => calculateOccurrencesDetailed(params, viewStartDate, viewEndDate).map((o) => o.date);
