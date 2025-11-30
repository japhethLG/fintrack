/**
 * Utility functions for balance calculations
 */

import { BalanceStatus } from "@/lib/types";
import { addDays } from "@/lib/utils/dateUtils";

/**
 * Get the balance status based on current balance and warning threshold
 */
export const getBalanceStatus = (balance: number, warningThreshold: number): BalanceStatus => {
  if (balance < 0) return "danger";
  if (balance < warningThreshold) return "warning";
  return "safe";
};

/**
 * Get array of dates between start and end (inclusive)
 */
export const getDaysBetween = (start: Date, end: Date): Date[] => {
  const days: Date[] = [];
  let current = new Date(start);

  while (current <= end) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }

  return days;
};
