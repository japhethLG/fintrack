import { useState, useCallback } from "react";

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
    const today = new Date();
    // Default: 2 months back to 4 months forward
    const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
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

