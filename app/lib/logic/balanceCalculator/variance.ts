/**
 * Variance analysis between projected and actual amounts
 */

import { Transaction, VarianceReport } from "@/lib/types";

/**
 * Calculate variance between projected and actual transactions
 * @param transactions - All transactions to analyze
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
 * @returns Variance report with income, expense, and category breakdowns
 */
export const calculateVarianceReport = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): VarianceReport => {
  // Filter completed transactions in date range
  const completedTransactions = transactions.filter(
    (t) => t.status === "completed" && t.scheduledDate >= startDate && t.scheduledDate <= endDate
  );

  // Calculate totals
  let projectedIncome = 0;
  let actualIncome = 0;
  let projectedExpenses = 0;
  let actualExpenses = 0;

  const categoryMap = new Map<string, { projected: number; actual: number }>();

  completedTransactions.forEach((t) => {
    const actual = t.actualAmount ?? t.projectedAmount;

    if (t.type === "income") {
      projectedIncome += t.projectedAmount;
      actualIncome += actual;
    } else {
      projectedExpenses += t.projectedAmount;
      actualExpenses += actual;

      // Track by category
      const existing = categoryMap.get(t.category) || { projected: 0, actual: 0 };
      existing.projected += t.projectedAmount;
      existing.actual += actual;
      categoryMap.set(t.category, existing);
    }
  });

  // Build category breakdown
  const byCategory = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    projected: data.projected,
    actual: data.actual,
    variance: data.actual - data.projected,
  }));

  // Calculate percentages
  const incomeVariance = actualIncome - projectedIncome;
  const incomeVariancePercent = projectedIncome > 0 ? (incomeVariance / projectedIncome) * 100 : 0;

  const expenseVariance = actualExpenses - projectedExpenses;
  const expenseVariancePercent =
    projectedExpenses > 0 ? (expenseVariance / projectedExpenses) * 100 : 0;

  return {
    period: { start: startDate, end: endDate },
    income: {
      projected: projectedIncome,
      actual: actualIncome,
      variance: incomeVariance,
      variancePercent: incomeVariancePercent,
    },
    expenses: {
      projected: projectedExpenses,
      actual: actualExpenses,
      variance: expenseVariance,
      variancePercent: expenseVariancePercent,
    },
    byCategory,
  };
};

