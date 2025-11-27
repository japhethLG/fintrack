import dayjs from "dayjs";

/**
 * Standard date format used for storage and keys (YYYY-MM-DD)
 */
export const DATE_FORMAT = "YYYY-MM-DD";

/**
 * Parse a date string (YYYY-MM-DD) as local time.
 * This avoids the timezone issues with new Date("YYYY-MM-DD") which parses as UTC.
 */
export const parseDate = (dateStr: string): Date => {
  return dayjs(dateStr).toDate();
};

/**
 * Format a Date object to YYYY-MM-DD string using local time.
 * This avoids the timezone issues with toISOString() which outputs UTC.
 */
export const formatDate = (date: Date): string => {
  return dayjs(date).format(DATE_FORMAT);
};

/**
 * Check if two dates are the same day (ignoring time).
 */
export const isSameDay = (date1: Date, date2: Date): boolean => {
  return dayjs(date1).isSame(dayjs(date2), "day");
};

/**
 * Get the start of day (midnight) for a given date.
 */
export const startOfDay = (date: Date): Date => {
  return dayjs(date).startOf("day").toDate();
};

/**
 * Get today's date formatted as YYYY-MM-DD.
 */
export const getTodayKey = (): string => {
  return dayjs().format(DATE_FORMAT);
};

/**
 * Add days to a date and return a new Date object.
 */
export const addDays = (date: Date, days: number): Date => {
  return dayjs(date).add(days, "day").toDate();
};

/**
 * Add months to a date and return a new Date object.
 */
export const addMonths = (date: Date, months: number): Date => {
  return dayjs(date).add(months, "month").toDate();
};

/**
 * Add weeks to a date and return a new Date object.
 */
export const addWeeks = (date: Date, weeks: number): Date => {
  return dayjs(date).add(weeks, "week").toDate();
};

/**
 * Add years to a date and return a new Date object.
 */
export const addYears = (date: Date, years: number): Date => {
  return dayjs(date).add(years, "year").toDate();
};
