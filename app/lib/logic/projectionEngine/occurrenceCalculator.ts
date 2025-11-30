/**
 * Calculate occurrence dates for recurring schedules
 */

import { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { parseDate, addDays, addWeeks, addMonths } from "@/lib/utils/dateUtils";
import { adjustForWeekend, clampDayToMonth } from "./dateUtils";

interface OccurrenceParams {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;
  scheduleConfig: ScheduleConfig;
  weekendAdjustment: "before" | "after" | "none";
}

/**
 * Calculate all occurrence dates for a recurring schedule within a date range
 * @param params - Schedule parameters
 * @param viewStartDate - Start of viewing period
 * @param viewEndDate - End of viewing period
 * @returns Array of occurrence dates
 */
export const calculateOccurrences = (
  params: OccurrenceParams,
  viewStartDate: Date,
  viewEndDate: Date
): Date[] => {
  const occurrences: Date[] = [];
  const start = parseDate(params.startDate);
  const end = params.endDate ? parseDate(params.endDate) : viewEndDate;
  const effectiveEnd = end < viewEndDate ? end : viewEndDate;

  // Safety check: ensure scheduleConfig is defined
  const scheduleConfig = params.scheduleConfig || {};

  // Safety limit to prevent infinite loops (max 500 occurrences)
  const MAX_OCCURRENCES = 500;

  if (start > effectiveEnd) return [];

  switch (params.frequency) {
    case "one-time": {
      if (start >= viewStartDate && start <= effectiveEnd) {
        occurrences.push(adjustForWeekend(start, params.weekendAdjustment));
      }
      break;
    }

    case "daily": {
      let current = new Date(Math.max(start.getTime(), viewStartDate.getTime()));
      while (current <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        current = addDays(current, 1);
      }
      break;
    }

    case "weekly": {
      // Start from the first occurrence on or after viewStartDate
      let current = new Date(start);

      // Find the first occurrence (with safety limit)
      if (scheduleConfig.dayOfWeek !== undefined) {
        const targetDay = scheduleConfig.dayOfWeek;
        let alignmentAttempts = 0;
        while (current.getDay() !== targetDay && alignmentAttempts < 7) {
          current = addDays(current, 1);
          alignmentAttempts++;
        }
      }

      while (current <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        if (current >= viewStartDate) {
          occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        }
        current = addWeeks(current, 1);
      }
      break;
    }

    case "bi-weekly": {
      const intervalWeeks = scheduleConfig.intervalWeeks || 2;
      let current = new Date(start);

      // Align to correct day if specified (with safety limit)
      if (scheduleConfig.dayOfWeek !== undefined) {
        const targetDay = scheduleConfig.dayOfWeek;
        let alignmentAttempts = 0;
        while (current.getDay() !== targetDay && alignmentAttempts < 7) {
          current = addDays(current, 1);
          alignmentAttempts++;
        }
      }

      while (current <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        if (current >= viewStartDate) {
          occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        }
        current = addWeeks(current, intervalWeeks);
      }
      break;
    }

    case "semi-monthly": {
      // Specific dates like 15th and 30th
      const specificDays = scheduleConfig.specificDays || [15, 30];
      let monthCursor = new Date(start);
      monthCursor.setDate(1); // Start from beginning of month

      while (monthCursor <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        const year = monthCursor.getFullYear();
        const month = monthCursor.getMonth();

        specificDays.forEach((day) => {
          if (occurrences.length >= MAX_OCCURRENCES) return;
          const actualDay = clampDayToMonth(day, year, month);
          const date = new Date(year, month, actualDay);

          if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
            occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
          }
        });

        monthCursor = addMonths(monthCursor, 1);
      }
      break;
    }

    case "monthly": {
      const dayOfMonth = scheduleConfig.dayOfMonth || start.getDate();
      let monthCursor = new Date(start);

      while (monthCursor <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        const year = monthCursor.getFullYear();
        const month = monthCursor.getMonth();
        const actualDay = clampDayToMonth(dayOfMonth, year, month);
        const date = new Date(year, month, actualDay);

        // Must be on or after the start date, within view window, and before end
        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        monthCursor = addMonths(monthCursor, 1);
      }
      break;
    }

    case "quarterly": {
      const dayOfMonth = scheduleConfig.dayOfMonth || 1;
      let current = new Date(start);

      while (current <= effectiveEnd && occurrences.length < MAX_OCCURRENCES) {
        const year = current.getFullYear();
        const month = current.getMonth();
        const actualDay = clampDayToMonth(dayOfMonth, year, month);
        const date = new Date(year, month, actualDay);

        // Must be on or after the start date, within view window, and before end
        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        current = addMonths(current, 3);
      }
      break;
    }

    case "yearly": {
      const monthOfYear = scheduleConfig.monthOfYear || start.getMonth();
      const dayOfMonth = scheduleConfig.dayOfMonth || start.getDate();
      let yearCursor = start.getFullYear();

      while (yearCursor <= effectiveEnd.getFullYear() && occurrences.length < MAX_OCCURRENCES) {
        const actualDay = clampDayToMonth(dayOfMonth, yearCursor, monthOfYear);
        const date = new Date(yearCursor, monthOfYear, actualDay);

        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        yearCursor++;
      }
      break;
    }
  }

  return occurrences;
};

