/**
 * Chart data generation for health score visualizations
 */

import { Transaction } from "@/lib/types";
import { dayNumberOfDate, formatDate, parseDate } from "@/lib/utils/dateUtils";

export type BucketType = "daily" | "weekly" | "monthly";

export interface ChartDataPoint {
  label: string;
  date: string;
  income: number;
  expenses: number;
  net: number;
}

/**
 * Calculate income vs expense data for charting
 * @param transactions - All transactions to analyze
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
 * @param bucketType - How to group data points
 * @returns Array of chart data points
 */
export const getIncomeExpenseChartData = (
  transactions: Transaction[],
  startDate: string,
  endDate: string,
  bucketType: BucketType = "daily"
): ChartDataPoint[] => {
  const buckets = new Map<string, { income: number; expenses: number }>();

  // Filter transactions in range
  const filteredTransactions = transactions.filter((t) => {
    const date = t.actualDate || t.scheduledDate;
    return date >= startDate && date <= endDate && t.status !== "skipped";
  });

  // Group by bucket
  filteredTransactions.forEach((t) => {
    const date = parseDate(t.actualDate || t.scheduledDate);
    let bucketKey: string;

    if (bucketType === "daily") {
      bucketKey = formatDate(date);
    } else if (bucketType === "weekly") {
      // Get week start (Sunday)
      const weekStart = new Date(date.getTime());
      weekStart.setDate(date.getDate() - date.getDay());
      bucketKey = formatDate(weekStart);
    } else {
      // Monthly
      bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }

    const existing = buckets.get(bucketKey) || { income: 0, expenses: 0 };
    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      existing.income += amount;
    } else {
      existing.expenses += amount;
    }

    buckets.set(bucketKey, existing);
  });

  // Convert to array and sort by date
  const result = Array.from(buckets.entries())
    .map(([date, data]) => {
      // `date` is a bucket key (YYYY-MM-DD, or YYYY-MM for monthly): parse it as LOCAL time.
      const d = parseDate(date);
      let label: string;

      if (bucketType === "daily") {
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } else if (bucketType === "weekly") {
        label = `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      } else {
        label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      }

      return {
        label,
        date,
        income: data.income,
        expenses: data.expenses,
        net: data.income - data.expenses,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
};

/**
 * Determine the best bucket type based on date range
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
 * @returns Recommended bucket type
 */
export const getBestBucketType = (startDate: string, endDate: string): BucketType => {
  // Whole calendar days between the two local days (no wall-clock arithmetic, so DST cannot skew it).
  const daysDiff = dayNumberOfDate(parseDate(endDate)) - dayNumberOfDate(parseDate(startDate));

  if (daysDiff <= 14) return "daily";
  if (daysDiff <= 90) return "weekly";
  return "monthly";
};
