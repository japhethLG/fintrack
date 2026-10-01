"use client";

import { useCallback, useContext, useMemo } from "react";
import FinancialContext from "@/contexts/FinancialContext";
import {
  formatDateByPreference,
  formatDayMonthByPreference,
  formatDayMonthYearByPreference,
  formatWeekdayDayMonthByPreference,
  resolveDateFormat,
  resolveStartOfWeek,
  startOfWeekDate,
  weekColumn,
  weekdayLabels,
} from "@/lib/utils/datePreferences";

/**
 * The user's Settings > Preferences for dates: how a day is printed and which day a week starts on.
 * (Mirrors `useCurrency`.) Outside a provider, or before the profile loads, it falls back to the
 * defaults (MM/DD/YYYY, Sunday), so a component never has to guard.
 *
 * Display only. Stored dates stay "YYYY-MM-DD".
 *
 *   const { formatDate, startOfWeek, weekdayLabels, weekColumn } = useDatePreferences();
 *   formatDate("2026-10-03")        // "10/03/2026" | "03/10/2026" | "2026-10-03"
 *   formatDayMonthYear(date)        // "Oct 3, 2026" | "3 Oct 2026"
 *   weekdayLabels                   // ["Sun", ..., "Sat"] or ["Mon", ..., "Sun"]: the header row
 *   weekColumn(new Date(y, m, 1))   // 0..6 column of a date in the grid (leading blanks)
 *   weekStart(date)                 // first day of the week containing `date`
 */
export const useDatePreferences = () => {
  const financial = useContext(FinancialContext);
  const preferences = financial?.userProfile?.preferences;
  const dateFormat = resolveDateFormat(preferences?.dateFormat);
  const startOfWeek = resolveStartOfWeek(preferences?.startOfWeek);

  /** Numeric date in the preferred order ("10/03/2026"). */
  const formatDate = useCallback(
    (date: string | Date) => formatDateByPreference(date, dateFormat),
    [dateFormat]
  );
  /** Month name, no year ("Oct 3" / "3 Oct"). */
  const formatDayMonth = useCallback(
    (date: string | Date) => formatDayMonthByPreference(date, dateFormat),
    [dateFormat]
  );
  /** Month name and year ("Oct 3, 2026" / "3 Oct 2026"); `weekday: true` prefixes "Sat,". */
  const formatDayMonthYear = useCallback(
    (date: string | Date, options?: { weekday?: boolean }) =>
      formatDayMonthYearByPreference(date, dateFormat, options),
    [dateFormat]
  );
  /** Long weekday, day and month name ("Saturday, Oct 3" / "Saturday, 3 Oct"). */
  const formatWeekdayDayMonth = useCallback(
    (date: string | Date) => formatWeekdayDayMonthByPreference(date, dateFormat),
    [dateFormat]
  );
  const labels = useMemo(() => weekdayLabels(startOfWeek), [startOfWeek]);
  const column = useCallback((date: Date) => weekColumn(date, startOfWeek), [startOfWeek]);
  const weekStart = useCallback((date: Date) => startOfWeekDate(date, startOfWeek), [startOfWeek]);

  return {
    dateFormat,
    startOfWeek,
    formatDate,
    formatDayMonth,
    formatDayMonthYear,
    formatWeekdayDayMonth,
    weekdayLabels: labels,
    weekColumn: column,
    weekStart,
  };
};

export default useDatePreferences;
