/**
 * Date utility functions for projection calculations
 */

import { addDays } from "@/lib/utils/dateUtils";

/**
 * Check if a date falls on a weekend
 */
export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

/**
 * Adjust a date if it falls on a weekend
 * @param date - Date to adjust
 * @param adjustment - How to adjust: "before" (to Friday), "after" (to Monday), or "none"
 */
export const adjustForWeekend = (date: Date, adjustment: "before" | "after" | "none"): Date => {
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

/**
 * Get the last day of a given month
 */
export const getLastDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

/**
 * Clamp a day number to be valid for a given month
 * (e.g., day 31 in February becomes day 28/29)
 */
export const clampDayToMonth = (day: number, year: number, month: number): number => {
  const maxDay = getLastDayOfMonth(year, month);
  return Math.min(day, maxDay);
};

