/**
 * The two date preferences of Settings, as pure helpers.
 *
 *   - `dateFormat`  : how a calendar day is PRINTED ("MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD").
 *   - `startOfWeek` : the first column of a week grid (0 = Sunday, 1 = Monday).
 *
 * They only change what the user SEES. Stored dates are always "YYYY-MM-DD" (see dateUtils) and
 * every key, comparison and query keeps using that. Components get these through the
 * `useDatePreferences` hook (app/lib/hooks/useDatePreferences.ts); the calendar grid uses
 * `weekdayLabels` / `weekColumn` / `startOfWeekDate` with the same hook's `startOfWeek`.
 */

import dayjs from "dayjs";
import updateLocale from "dayjs/plugin/updateLocale";
import { parseDate } from "./dateUtils";

dayjs.extend(updateLocale);

export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const;
export type DateFormatPreference = (typeof DATE_FORMATS)[number];
export type StartOfWeek = 0 | 1;

export const DEFAULT_DATE_FORMAT: DateFormatPreference = "MM/DD/YYYY";
export const DEFAULT_START_OF_WEEK: StartOfWeek = 0;

/** A stored `dateFormat`, or the default when it is missing or not one we support. */
export const resolveDateFormat = (raw: unknown): DateFormatPreference =>
  (DATE_FORMATS as readonly string[]).includes(raw as string)
    ? (raw as DateFormatPreference)
    : DEFAULT_DATE_FORMAT;

/** A stored `startOfWeek` (a number or a numeric string), or Sunday when missing or unknown. */
export const resolveStartOfWeek = (raw: unknown): StartOfWeek => {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return n === 1 ? 1 : DEFAULT_START_OF_WEEK;
};

const toDayjs = (date: string | Date) => dayjs(typeof date === "string" ? parseDate(date) : date);

/** Format with `render`, or hand back the input untouched when it is not a real date (never "Invalid Date"). */
const safely = (date: string | Date, render: (d: dayjs.Dayjs) => string): string => {
  const d = toDayjs(date);
  return d.isValid() ? render(d) : String(date);
};

/** Whether the day comes before the month in a format ("3 Oct 2026" rather than "Oct 3, 2026"). */
const isDayFirst = (format: DateFormatPreference): boolean => format === "DD/MM/YYYY";

/**
 * A day as numbers in the preferred order, zero padded: "10/03/2026" (MM/DD/YYYY),
 * "03/10/2026" (DD/MM/YYYY) or "2026-10-03" (YYYY-MM-DD).
 */
export const formatDateByPreference = (
  date: string | Date,
  format: DateFormatPreference = DEFAULT_DATE_FORMAT
): string => safely(date, (d) => d.format(format));

/** A day with a month name and no year: "Oct 3", or "3 Oct" for day-first. */
export const formatDayMonthByPreference = (
  date: string | Date,
  format: DateFormatPreference = DEFAULT_DATE_FORMAT
): string => safely(date, (d) => d.format(isDayFirst(format) ? "D MMM" : "MMM D"));

/**
 * A day with a month name and the year: "Oct 3, 2026", or "3 Oct 2026" for day-first.
 * `weekday` adds the short weekday in front ("Sat, Oct 3, 2026").
 */
export const formatDayMonthYearByPreference = (
  date: string | Date,
  format: DateFormatPreference = DEFAULT_DATE_FORMAT,
  options: { weekday?: boolean } = {}
): string => {
  return safely(date, (d) => {
    const body = d.format(isDayFirst(format) ? "D MMM YYYY" : "MMM D, YYYY");
    return options.weekday ? `${d.format("ddd")}, ${body}` : body;
  });
};

/** A day as long weekday + day + month name: "Saturday, Oct 3", or "Saturday, 3 Oct" for day-first. */
export const formatWeekdayDayMonthByPreference = (
  date: string | Date,
  format: DateFormatPreference = DEFAULT_DATE_FORMAT
): string => safely(date, (d) => d.format(isDayFirst(format) ? "dddd, D MMM" : "dddd, MMM D"));

const WEEKDAYS_SUNDAY_FIRST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** The seven short weekday names in column order: Sun..Sat, or Mon..Sun when the week starts Monday. */
export const weekdayLabels = (startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK): string[] => [
  ...WEEKDAYS_SUNDAY_FIRST.slice(startOfWeek),
  ...WEEKDAYS_SUNDAY_FIRST.slice(0, startOfWeek),
];

/** Column (0..6) a date falls in on a week grid that starts on `startOfWeek`. */
export const weekColumn = (
  date: Date,
  startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK
): number => (date.getDay() - startOfWeek + 7) % 7;

/** The first day of the week (local midnight) that contains `date`. */
export const startOfWeekDate = (
  date: Date,
  startOfWeek: StartOfWeek = DEFAULT_START_OF_WEEK
): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekColumn(date, startOfWeek));

/**
 * Make dayjs (and so antd's date pickers: the weekday header of the calendar panel, "This Week"
 * range presets, `startOf("week")`) agree with the preference. Called by the FinancialProvider
 * whenever the stored preference changes. The calendar GRID does not use dayjs's week; it takes
 * `startOfWeek` from `useDatePreferences`.
 */
export const applyDayjsWeekStart = (startOfWeek: StartOfWeek): void => {
  dayjs.updateLocale(dayjs.locale(), { weekStart: startOfWeek });
};
