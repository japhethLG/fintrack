import { useState, useCallback } from "react";
import { formatDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";

interface DateRange {
  start: string;
  end: string;
}

/**
 * Hook to manage the view date range for projections
 * Date range expands as needed but never shrinks
 * Default: 2 months back to 4 months forward
 */
export function useViewDateRange() {
  const [viewDateRange, setViewDateRangeState] = useState<DateRange>(() => {
    // "Today" is the local calendar day; bounds are local calendar days, serialised with formatDate.
    // (toISOString() would stamp the UTC day, a day early at any UTC+ offset.)
    const today = parseDate(getTodayKey());
    // Default: 2 months back (1st of that month) to 4 months forward (day 0 = last day of month+3)
    const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return {
      start: formatDate(startDate),
      end: formatDate(endDate),
    };
  });

  // Set view date range (expands if needed, never shrinks)
  const setViewDateRange = useCallback((start: string, end: string) => {
    setViewDateRangeState((current) => {
      const newStart = start < current.start ? start : current.start;
      const newEnd = end > current.end ? end : current.end;

      // Only update if range actually changed
      if (newStart === current.start && newEnd === current.end) {
        return current;
      }

      return { start: newStart, end: newEnd };
    });
  }, []);

  return { viewDateRange, setViewDateRange };
}

