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

// ============================================================================
// Day numbers: a calendar day as an integer, for iterating and comparing days
// without wall-clock instants (DST- and time-zone-free).
// ============================================================================

const MS_PER_DAY = 86_400_000;

/** Day number (days since 1970-01-01) of a calendar day; month is zero-based like `Date`. */
export const toDayNumber = (year: number, month: number, day: number): number =>
  Math.floor(Date.UTC(year, month, day) / MS_PER_DAY);

/** Day number of the LOCAL calendar day a `Date` falls on (`NaN` for an invalid Date). */
export const dayNumberOfDate = (date: Date): number =>
  toDayNumber(date.getFullYear(), date.getMonth(), date.getDate());

/** Calendar parts of a day number (month zero-based). */
export const civilFromDayNumber = (n: number): { year: number; month: number; day: number } => {
  const utc = new Date(n * MS_PER_DAY);
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth(), day: utc.getUTCDate() };
};

/** Local-midnight `Date` for a day number. */
export const dateFromDayNumber = (n: number): Date => {
  const { year, month, day } = civilFromDayNumber(n);
  return new Date(year, month, day);
};

/** Weekday of a day number: 0 = Sunday ... 6 = Saturday. (1970-01-01 was a Thursday.) */
export const weekdayOfDayNumber = (n: number): number => (((n + 4) % 7) + 7) % 7;

/** Month index on a continuous axis: `year * 12 + month` (month zero-based). */
export const monthIndexOfDayNumber = (n: number): number => {
  const { year, month } = civilFromDayNumber(n);
  return year * 12 + month;
};

/**
 * Every local calendar day from `start` to `end` inclusive, as local-midnight Dates.
 * Iterates by day index, so a DST change (including one at 00:00, where the wall
 * clock skips midnight) can neither skip nor repeat a day.
 */
export const eachDayBetween = (start: Date, end: Date): Date[] => {
  const first = dayNumberOfDate(start);
  const last = dayNumberOfDate(end);
  const days: Date[] = [];
  for (let n = first; n <= last; n++) days.push(dateFromDayNumber(n));
  return days;
};
