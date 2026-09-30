/**
 * The occurrence id as it was derived BEFORE identity moved to the logical date.
 *
 * Older versions of the engine fed the WEEKEND-ADJUSTED date to the id
 * generator, so stored rows (completed/skipped transactions) written then carry
 * ids labelled by the adjusted date. This module reproduces that formula
 * exactly, and is used in ONE place: the merge, to recognise such a stored row
 * as the projection it was written for (see projectionMerger.ts). It must never
 * be used to write new ids.
 *
 * Kept byte-for-byte equivalent to the old implementation, including its quirks
 * (slot fallback capped at 2, millisecond-based bi-weekly index).
 */

import { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { formatDate, parseDate, startOfDay } from "@/lib/utils/dateUtils";

const pad = (value: number, size = 2) => value.toString().padStart(size, "0");

const getISOWeekInfo = (date: Date): { year: number; week: number } => {
  const target = startOfDay(date);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getDay() + 6) % 7)) /
        7
    );
  return { year: target.getFullYear(), week };
};

const getBiWeeklyIndex = (startDate: Date, currentDate: Date, intervalWeeks = 2): number => {
  const start = startOfDay(startDate).getTime();
  const current = startOfDay(currentDate).getTime();
  const diffDays = Math.floor((current - start) / 86400000);
  return Math.floor(diffDays / (intervalWeeks * 7)) + 1;
};

const getSemiMonthlyIndex = (date: Date, specificDays: number[] = [15, 30]): number => {
  const sorted = Array.from(new Set(specificDays)).sort((a, b) => a - b);
  const day = date.getDate();
  const exactIdx = sorted.findIndex((d) => d === day);
  if (exactIdx >= 0) return exactIdx + 1;
  return day <= sorted[0] ? 1 : 2;
};

/** The pre-fix id for an occurrence, derived from its (weekend-adjusted) date. Migration aid only. */
export const generateLegacyOccurrenceId = (
  sourceId: string,
  frequency: IncomeFrequency,
  adjustedDate: Date,
  startDate: string,
  scheduleConfig: ScheduleConfig = {}
): string => {
  const target = startOfDay(adjustedDate);
  const start = parseDate(startDate);
  const year = target.getFullYear();
  const month = pad(target.getMonth() + 1);

  switch (frequency) {
    case "one-time":
      return `${sourceId}_once`;
    case "daily":
      return `${sourceId}_${formatDate(target)}`;
    case "weekly": {
      const { year: weekYear, week } = getISOWeekInfo(target);
      return `${sourceId}_${weekYear}-W${pad(week)}`;
    }
    case "bi-weekly":
      return `${sourceId}_BW${getBiWeeklyIndex(start, target, scheduleConfig.intervalWeeks || 2)}`;
    case "semi-monthly":
      return `${sourceId}_${year}-${month}-${getSemiMonthlyIndex(target, scheduleConfig.specificDays || [15, 30])}`;
    case "monthly":
      return `${sourceId}_${year}-${month}`;
    case "quarterly":
      return `${sourceId}_${year}-Q${Math.floor(target.getMonth() / 3) + 1}`;
    case "yearly":
      return `${sourceId}_${year}`;
    default:
      return `${sourceId}_${formatDate(target)}`;
  }
};
