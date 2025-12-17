/**
 * Frequency Utilities
 *
 * Shared frequency multiplier calculations for consistent monthly projections
 * across Income, Expense, and Forecast pages.
 */

import { IncomeFrequency } from "@/lib/types";

/**
 * Get the multiplier to convert a frequency amount to monthly equivalent
 * @param frequency - The payment frequency
 * @returns Multiplier to convert to monthly (e.g., weekly * 4.33 = monthly)
 */
export const getMonthlyMultiplier = (frequency: IncomeFrequency): number => {
  switch (frequency) {
    case "daily":
      return 30;
    case "weekly":
      return 52 / 12; // ~4.333
    case "bi-weekly":
      return 26 / 12; // ~2.167
    case "semi-monthly":
      return 2;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "yearly":
      return 1 / 12;
    case "one-time":
    default:
      return 0;
  }
};

/**
 * Calculate prorated amount for a specific date range
 * @param monthlyAmount - The monthly equivalent amount
 * @param startDate - Range start date (YYYY-MM-DD)
 * @param endDate - Range end date (YYYY-MM-DD)
 * @returns Prorated amount for the date range
 */
export const prorateToDateRange = (
  monthlyAmount: number,
  startDate: string,
  endDate: string
): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysInMonth = 30; // Use 30-day month for consistency
  return (monthlyAmount / daysInMonth) * daysDiff;
};
