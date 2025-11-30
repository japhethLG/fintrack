/**
 * Summary and aggregate calculations
 */

import { Transaction } from "@/lib/types";
import { formatDate } from "@/lib/utils/dateUtils";

/**
 * Calculate income, expenses, and net for a specific month
 * @param transactions - All transactions
 * @param year - Year to analyze
 * @param month - Month to analyze (0-indexed, 0 = January)
 * @returns Object with income, expenses, and net totals
 */
export const calculateMonthlyTotals = (
  transactions: Transaction[],
  year: number,
  month: number
): { income: number; expenses: number; net: number } => {
  const startDate = formatDate(new Date(year, month, 1));
  const endDate = formatDate(new Date(year, month + 1, 0));

  let income = 0;
  let expenses = 0;

  transactions.forEach((t) => {
    const date = t.actualDate || t.scheduledDate;
    if (date < startDate || date > endDate) return;
    if (t.status === "skipped") return;

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
  };
};
