/**
 * Date helpers for tests.
 *
 * Deliberately implemented with raw `Date` accessors rather than reusing
 * `app/lib/utils/dateUtils` (dayjs). Tests must not validate the engine's date
 * handling using the same code path the engine uses — otherwise a bug in
 * parsing or formatting cancels itself out.
 */

/** Construct a local-midnight Date from "YYYY-MM-DD". */
export const d = (ymd: string): Date => {
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0);
};

/** Format a Date as "YYYY-MM-DD" using local calendar fields. */
export const ymd = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** Map a list of Dates to "YYYY-MM-DD" strings — for readable assertions. */
export const ymdAll = (dates: Date[]): string[] => dates.map(ymd);

/** Three-letter weekday name, for asserting weekend adjustment intent. */
export const weekday = (date: Date | string): string =>
  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
    (typeof date === "string" ? d(date) : date).getDay()
  ];

/** Inclusive list of "YYYY-MM-DD" strings between two calendar days. */
export const daysBetween = (startYmd: string, endYmd: string): string[] => {
  const out: string[] = [];
  const end = d(endYmd);
  const cursor = d(startYmd);
  while (cursor <= end) {
    out.push(ymd(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

/** Duplicate values in an array — used to assert occurrence uniqueness. */
export const duplicates = <T>(items: T[]): T[] =>
  items.filter((item, i) => items.indexOf(item) !== i);
