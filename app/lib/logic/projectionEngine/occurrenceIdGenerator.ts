/**
 * Generates stable occurrence identifiers for recurring transactions.
 * The ID represents the logical recurrence period (e.g., "rent_2025-01")
 * so it remains stable even if the scheduled date shifts (weekend adjust,
 * user drag/drop, or rule date changes).
 */

import { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { formatDate, parseDate, startOfDay } from "@/lib/utils/dateUtils";

const pad = (value: number, size = 2) => value.toString().padStart(size, "0");

const getISOWeekInfo = (date: Date): { year: number; week: number } => {
  // ISO week date algorithm
  const target = startOfDay(date);
  // Thursday in current week decides the year.
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) /
        7
    );
  const year = target.getFullYear();
  return { year, week };
};

const getBiWeeklyIndex = (startDate: Date, currentDate: Date, intervalWeeks = 2): number => {
  const start = startOfDay(startDate).getTime();
  const current = startOfDay(currentDate).getTime();
  const diffDays = Math.floor((current - start) / 86400000);
  const intervalDays = intervalWeeks * 7;
  return Math.floor(diffDays / intervalDays) + 1;
};

const getSemiMonthlyIndex = (date: Date, specificDays: number[] = [15, 30]): number => {
  const sorted = Array.from(new Set(specificDays)).sort((a, b) => a - b);
  const day = date.getDate();
  const exactIdx = sorted.findIndex((d) => d === day);
  if (exactIdx >= 0) return exactIdx + 1;

  // Fallback: choose nearest slot
  return day <= sorted[0] ? 1 : 2;
};

/**
 * Generate a stable occurrence identifier for a projected transaction.
 */
export const generateOccurrenceId = (
  sourceId: string,
  frequency: IncomeFrequency,
  date: Date,
  startDate: string,
  scheduleConfig: ScheduleConfig = {}
): string => {
  const target = startOfDay(date);
  const start = parseDate(startDate);
  const year = target.getFullYear();
  const month = pad(target.getMonth() + 1);
  const day = pad(target.getDate());

  switch (frequency) {
    case "one-time":
      return `${sourceId}_once`;

    case "daily":
      return `${sourceId}_${formatDate(target)}`;

    case "weekly": {
      const { year: weekYear, week } = getISOWeekInfo(target);
      return `${sourceId}_${weekYear}-W${pad(week)}`;
    }

    case "bi-weekly": {
      const interval = scheduleConfig.intervalWeeks || 2;
      const occurrenceNumber = getBiWeeklyIndex(start, target, interval);
      return `${sourceId}_BW${occurrenceNumber}`;
    }

    case "semi-monthly": {
      const index = getSemiMonthlyIndex(target, scheduleConfig.specificDays || [15, 30]);
      return `${sourceId}_${year}-${month}-${index}`;
    }

    case "monthly":
      return `${sourceId}_${year}-${month}`;

    case "quarterly": {
      const quarter = Math.floor(target.getMonth() / 3) + 1;
      return `${sourceId}_${year}-Q${quarter}`;
    }

    case "yearly":
      return `${sourceId}_${year}`;

    default:
      // Fallback for unexpected frequencies
      return `${sourceId}_${formatDate(target)}`;
  }
};

