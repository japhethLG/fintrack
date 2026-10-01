/**
 * Chart data generation for health score visualizations
 */

import { Transaction } from "@/lib/types";
import {
  dateFromDayNumber,
  dayNumberOfDate,
  formatDate,
  parseDate,
  weekdayOfDayNumber,
} from "@/lib/utils/dateUtils";
import { amountOf, rowDate } from "@/lib/logic/balanceCalculator/openItems";

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

  // Bucket key of a calendar day (YYYY-MM-DD for daily, the Sunday for weekly, YYYY-MM for monthly)
  const bucketKeyOf = (day: number): string => {
    const date = dateFromDayNumber(day);
    if (bucketType === "daily") return formatDate(date);
    if (bucketType === "weekly") return formatDate(dateFromDayNumber(day - weekdayOfDayNumber(day)));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };

  // Filter transactions in range
  const filteredTransactions = transactions.filter((t) => {
    const date = rowDate(t);
    return date >= startDate && date <= endDate && t.status !== "skipped";
  });

  // No activity in the range: nothing to chart (the page shows its empty state).
  if (filteredTransactions.length === 0) return [];

  // Zero-fill: every bucket of the requested range exists, so a gap in the data is a visible gap
  // (a categorical chart axis would otherwise draw an 18-day pause as one day).
  const firstDay = dayNumberOfDate(parseDate(startDate));
  const lastDay = dayNumberOfDate(parseDate(endDate));
  for (let day = firstDay; day <= lastDay; day++) {
    const key = bucketKeyOf(day);
    if (!buckets.has(key)) buckets.set(key, { income: 0, expenses: 0 });
  }

  // Group by bucket
  filteredTransactions.forEach((t) => {
    const bucketKey = bucketKeyOf(dayNumberOfDate(parseDate(rowDate(t))));
    const existing = buckets.get(bucketKey) || { income: 0, expenses: 0 };
    const amount = amountOf(t);

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

/**
 * Which day offsets (0 = the first day) a line chart plots for a range of `daysDiff + 1` days.
 * Ranges longer than `maxPoints` are sampled every `ceil(daysDiff / maxPoints)` days to keep the
 * chart light, but the LAST day is always included: the closing balance of the range is the end of
 * the range, not the last sampled day (a 100-day range sampled every 2 days used to stop on day 98).
 */
export const sampleDayOffsets = (daysDiff: number, maxPoints: number = 90): number[] => {
  if (!Number.isFinite(daysDiff) || daysDiff < 0) return [];
  const step = daysDiff > maxPoints ? Math.ceil(daysDiff / maxPoints) : 1;
  const offsets: number[] = [];
  for (let offset = 0; offset <= daysDiff; offset += step) offsets.push(offset);
  if (offsets[offsets.length - 1] !== daysDiff) offsets.push(daysDiff);
  return offsets;
};
