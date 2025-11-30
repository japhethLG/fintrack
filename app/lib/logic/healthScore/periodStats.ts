/**
 * Period statistics calculations
 */

import { Transaction } from "@/lib/types";

/**
 * Get a summary of period statistics for comparison
 * @param transactions - All transactions to analyze
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
 * @returns Statistics summary for the period
 */
export const getPeriodStats = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): {
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  completedCount: number;
  skippedCount: number;
} => {
  let income = 0;
  let expenses = 0;
  let transactionCount = 0;
  let completedCount = 0;
  let skippedCount = 0;

  transactions.forEach((t) => {
    const date = t.actualDate || t.scheduledDate;
    if (date < startDate || date > endDate) return;

    transactionCount++;

    if (t.status === "skipped") {
      skippedCount++;
      return;
    }

    if (t.status === "completed") {
      completedCount++;
    }

    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      income += amount;
    } else {
      expenses += amount;
    }
  });

  return {
    income,
    expenses,
    net: income - expenses,
    transactionCount,
    completedCount,
    skippedCount,
  };
};

