/**
 * The schedule half of the income-source and expense-rule forms, as pure functions.
 *
 * One `buildScheduleConfig` serves both wizards for every frequency, and the Schedule Preview calls the
 * SAME `calculateOccurrencesDetailed` the projections use on the SAME config the form persists, so what the
 * user is shown is what is generated. Hidden schedule values (Day of Week, Day of Month, month of the year)
 * default from the ENTERED START DATE, never from today.
 */

import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { addDays, addMonths, parseDate } from "@/lib/utils/dateUtils";
import { calculateOccurrencesDetailed, type Occurrence } from "./projectionEngine/occurrenceCalculator";
import {
  MAX_WEEKEND_SHIFT_DAYS,
  adjustForWeekend,
  monthlyPaymentDate,
} from "./projectionEngine/dateUtils";

// ============================================================================
// Small helpers
// ============================================================================

/** "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd" ... */
export const ordinal = (n: number): string => {
  const v = Math.abs(n) % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (Math.abs(n) % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

/**
 * A whole number from a number or a numeric string (form inputs hand back strings), else `undefined`.
 * `""`, `NaN`, `1.5`, `"abc"`, `null` are all `undefined`.
 */
export const toWholeNumber = (value: unknown): number | undefined => {
  if (typeof value === "string") {
    if (value.trim() === "") return undefined;
    return toWholeNumber(Number(value));
  }
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
};

const inRange = (n: number | undefined, min: number, max: number): n is number =>
  n !== undefined && n >= min && n <= max;

export interface StartDateParts {
  /** 1..31 */
  dayOfMonth: number;
  /** 0 (Sunday) .. 6 */
  dayOfWeek: number;
  /** 0 (January) .. 11 */
  month: number;
}

/** The local calendar parts of a "YYYY-MM-DD" start date; null for blank / unparsable input. */
export const startDateParts = (startDate: unknown): StartDateParts | null => {
  if (typeof startDate !== "string" || !startDate) return null;
  const date = parseDate(startDate);
  if (Number.isNaN(date.getTime())) return null;
  return { dayOfMonth: date.getDate(), dayOfWeek: date.getDay(), month: date.getMonth() };
};

// ============================================================================
// buildScheduleConfig
// ============================================================================

export interface ScheduleFormInput {
  frequency: IncomeFrequency;
  startDate: string;
  specificDays?: readonly unknown[];
  dayOfWeek?: unknown;
  dayOfMonth?: unknown;
  monthOfYear?: unknown;
  intervalWeeks?: unknown;
}

/** The semi-monthly days a form holds: whole numbers 1..31, sorted, de-duplicated. */
export const cleanSpecificDays = (days: readonly unknown[] | undefined): number[] => {
  const valid = (days ?? [])
    .map(toWholeNumber)
    .filter((n): n is number => n !== undefined && n >= 1 && n <= 31);
  return Array.from(new Set(valid)).sort((a, b) => a - b);
};

/**
 * The `scheduleConfig` a form persists, for every frequency. Only the keys the frequency reads are written
 * (a one-time or daily rule persists `{}`), every number is a real number (never the string "31"), and a
 * missing value falls back to the START DATE's own weekday / day / month:
 *
 * | frequency    | keys                                   |
 * | ------------ | -------------------------------------- |
 * | one-time, daily | none                                |
 * | weekly       | dayOfWeek                              |
 * | bi-weekly    | dayOfWeek, intervalWeeks (default 2)   |
 * | semi-monthly | specificDays                           |
 * | monthly      | dayOfMonth                             |
 * | quarterly, yearly | dayOfMonth, monthOfYear           |
 */
export const buildScheduleConfig = (input: ScheduleFormInput): ScheduleConfig => {
  const start = startDateParts(input.startDate);
  const dayOfWeek = (): number => {
    const n = toWholeNumber(input.dayOfWeek);
    return inRange(n, 0, 6) ? n : (start?.dayOfWeek ?? 0);
  };
  const dayOfMonth = (): number => {
    const n = toWholeNumber(input.dayOfMonth);
    return inRange(n, 1, 31) ? n : (start?.dayOfMonth ?? 1);
  };
  const monthOfYear = (): number => {
    const n = toWholeNumber(input.monthOfYear);
    return inRange(n, 0, 11) ? n : (start?.month ?? 0);
  };

  switch (input.frequency) {
    case "weekly":
      return { dayOfWeek: dayOfWeek() };
    case "bi-weekly": {
      const interval = toWholeNumber(input.intervalWeeks);
      return { dayOfWeek: dayOfWeek(), intervalWeeks: interval !== undefined && interval >= 1 ? interval : 2 };
    }
    case "semi-monthly":
      return { specificDays: cleanSpecificDays(input.specificDays) };
    case "monthly":
      return { dayOfMonth: dayOfMonth() };
    case "quarterly":
    case "yearly":
      return { dayOfMonth: dayOfMonth(), monthOfYear: monthOfYear() };
    default:
      return {};
  }
};

// ============================================================================
// Validation
// ============================================================================

export interface RuleIssue {
  field: string;
  message: string;
}

export const SCHEDULE_MESSAGES = {
  startDate: "Enter a valid start date.",
  endBeforeStart: "The end date must be on or after the start date.",
  noSemiMonthlyDays: "Add at least one day of the month for a semi-monthly schedule.",
  dayOfMonth: "Day of month must be a whole number from 1 to 31.",
  dayOfWeek: "Choose a day of the week.",
} as const;

export interface ScheduleValidationInput {
  frequency: IncomeFrequency;
  startDate: string | null | undefined;
  endDate?: string | null;
  hasEndDate?: boolean;
  specificDays?: readonly unknown[];
  dayOfMonth?: unknown;
}

/**
 * Problems that must stop a schedule from being saved. A ticked "Set End Date" with no date is NOT a
 * problem: it simply persists no end date.
 */
export const validateSchedule = (input: ScheduleValidationInput): RuleIssue[] => {
  const issues: RuleIssue[] = [];
  const start = startDateParts(input.startDate);
  if (!start) issues.push({ field: "startDate", message: SCHEDULE_MESSAGES.startDate });

  if (start && input.hasEndDate && input.endDate && input.endDate < (input.startDate as string)) {
    // "YYYY-MM-DD" strings order like the dates they name
    issues.push({ field: "endDate", message: SCHEDULE_MESSAGES.endBeforeStart });
  }

  if (input.frequency === "semi-monthly" && cleanSpecificDays(input.specificDays).length === 0) {
    issues.push({ field: "specificDays", message: SCHEDULE_MESSAGES.noSemiMonthlyDays });
  }

  if (input.frequency === "monthly" || input.frequency === "quarterly" || input.frequency === "yearly") {
    const raw = input.dayOfMonth;
    const blank = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (!blank && !inRange(toWholeNumber(raw), 1, 31)) {
      issues.push({ field: "dayOfMonth", message: SCHEDULE_MESSAGES.dayOfMonth });
    }
  }

  return issues;
};

// ============================================================================
// Schedule preview (the real engine)
// ============================================================================

/** The preview looks this many months past the start date when the rule has no end date. */
export const PREVIEW_HORIZON_MONTHS = 3;

export interface SchedulePreviewInput {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string | null;
  hasEndDate?: boolean;
  weekendAdjustment: "before" | "after" | "none";
  /** The config the form will persist (`buildScheduleConfig`). */
  scheduleConfig: ScheduleConfig;
  /** A plan with a fixed number of payments (loan term, installment count) previews at most that many. */
  maxOccurrences?: number;
  /**
   * Payments of the plan already made (an edit of a loan / installment plan part-way through): the preview
   * starts at the next payment due instead of the first one; `maxOccurrences` counts the REMAINING ones.
   */
  alreadyPaid?: number;
}

export interface SchedulePreview {
  /** Dates where the rule's occurrences LAND (weekend adjustment applied), ascending. */
  dates: Date[];
  /**
   * The same occurrences with the day each was nominally due (`logicalDate`); it differs from `date` when
   * the weekend adjustment moved the payment (a Sunday 1 Nov payday paid on Friday 30 Oct).
   */
  occurrences: Occurrence[];
  /** The last day looked at: the end date (plus the weekend shift) or start + 3 months. */
  horizonEnd: Date | null;
}

/**
 * The occurrences the saved rule will generate, from its first payment to its end date or, without one,
 * to three months after the start date. It is `calculateOccurrencesDetailed` itself, so frequency, weekday,
 * month-end clamping, weekend adjustment and end date always match the projections. The window opens
 * `MAX_WEEKEND_SHIFT_DAYS` before the start date and closes that long after the end date, because a
 * "pay before" first payment can land ahead of the start date and a "pay after" last one past the end date.
 */
export const getSchedulePreview = (input: SchedulePreviewInput): SchedulePreview => {
  const start = startDateParts(input.startDate) ? parseDate(input.startDate) : null;
  if (!start) return { dates: [], occurrences: [], horizonEnd: null };

  const end = input.hasEndDate && input.endDate ? parseDate(input.endDate) : null;
  const hasEnd = end !== null && !Number.isNaN(end.getTime());
  const paid = Math.max(0, Math.floor(input.alreadyPaid ?? 0));
  const horizonEnd = hasEnd
    ? addDays(end as Date, MAX_WEEKEND_SHIFT_DAYS)
    : addMonths(start, PREVIEW_HORIZON_MONTHS + paid);

  const occurrences = calculateOccurrencesDetailed(
    {
      frequency: input.frequency,
      startDate: input.startDate,
      endDate: hasEnd ? (input.endDate as string) : undefined,
      scheduleConfig: input.scheduleConfig,
      weekendAdjustment: input.weekendAdjustment,
    },
    addDays(start, -MAX_WEEKEND_SHIFT_DAYS),
    horizonEnd
  );

  let shown = occurrences.slice(paid);
  if (input.maxOccurrences !== undefined && input.maxOccurrences >= 0) {
    shown = shown.slice(0, Math.floor(input.maxOccurrences));
  }
  return { dates: shown.map((o) => o.date), occurrences: shown, horizonEnd };
};

/**
 * The date of the LAST payment of a plan with a fixed number of monthly payments (an installment plan, a
 * loan's term), placed exactly as the projection engine places it: `count - 1` months after the first
 * payment (on the rule's Day of Month when it has one), moved for weekends when the rule asks.
 * Null when the start date or the count cannot describe a plan.
 */
export const lastMonthlyPaymentDate = (
  startDate: string,
  dayOfMonth: unknown,
  count: unknown,
  weekendAdjustment: "before" | "after" | "none" | undefined
): Date | null => {
  const n = toWholeNumber(count);
  if (!startDateParts(startDate) || n === undefined || n < 1) return null;
  const logical = monthlyPaymentDate(parseDate(startDate), dayOfMonth, n - 1);
  return weekendAdjustment === "before" || weekendAdjustment === "after"
    ? adjustForWeekend(logical, weekendAdjustment)
    : logical;
};

// ============================================================================
// Describing a saved schedule (detail cards)
// ============================================================================

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Every Friday", "On the 15th of each month", ... for a STORED rule. A missing weekday / day of the month
 * is read the way the engine reads it: from the start date. Frequencies without a special sentence return
 * `fallback`.
 */
export const describeSchedule = (
  frequency: IncomeFrequency,
  config: ScheduleConfig | undefined,
  startDate: string,
  fallback: string
): string => {
  const start = startDateParts(startDate);
  const cfg = config ?? {};
  const weekday = (): string => {
    const n = toWholeNumber(cfg.dayOfWeek);
    return DAY_NAMES[inRange(n, 0, 6) ? n : (start?.dayOfWeek ?? 0)];
  };
  switch (frequency) {
    case "semi-monthly":
      return `On the ${cleanSpecificDays(cfg.specificDays).map(ordinal).join(" and ")} of each month`;
    case "weekly":
      return `Every ${weekday()}`;
    case "bi-weekly": {
      const interval = toWholeNumber(cfg.intervalWeeks);
      return `Every ${interval !== undefined && interval >= 1 ? interval : 2} weeks on ${weekday()}`;
    }
    case "monthly": {
      const n = toWholeNumber(cfg.dayOfMonth);
      return `On the ${ordinal(inRange(n, 1, 31) ? n : (start?.dayOfMonth ?? 1))} of each month`;
    }
    default:
      return fallback;
  }
};
