/**
 * Variance analysis between projected and actual amounts
 */

import { Transaction, VarianceReport } from "@/lib/types";

/**
 * Calculate variance between the PLAN and what has actually happened.
 *
 * Rows are selected by their planned day (`scheduledDate`): the report answers "how is the plan for
 * this period turning out". The baseline is EVERY non-skipped row in range (completed or still
 * pending), so `projected` is the whole plan and a period that has delivered less than planned so
 * far shows a negative variance (under-delivery) instead of looking perfect. `actual` is what has
 * really been paid or received: completed rows at their recorded actual (an actual of 0 is a real
 * 0). Income categories are broken out as well as expense categories.
 *
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
  // Every planned row in range: completed, or still to come. Skipped rows left the plan.
  const planned = transactions.filter(
    (t) => t.status !== "skipped" && t.scheduledDate >= startDate && t.scheduledDate <= endDate
  );

  // Calculate totals
  let projectedIncome = 0;
  let actualIncome = 0;
  let projectedExpenses = 0;
  let actualExpenses = 0;

  const categoryMap = new Map<string, { category: string; projected: number; actual: number }>();

  planned.forEach((t) => {
    const actual = t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : 0;

    if (t.type === "income") {
      projectedIncome += t.projectedAmount;
      actualIncome += actual;
    } else {
      projectedExpenses += t.projectedAmount;
      actualExpenses += actual;
    }

    // Track by category (an income and an expense category of the same name stay separate rows)
    const key = `${t.type}\u0000${t.category}`;
    const existing = categoryMap.get(key) || { category: t.category, projected: 0, actual: 0 };
    existing.projected += t.projectedAmount;
    existing.actual += actual;
    categoryMap.set(key, existing);
  });

  // Build category breakdown
  const byCategory = Array.from(categoryMap.values()).map((data) => ({
    category: data.category,
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

export interface ProjectedVsActual {
  income: { projected: number; actual: number };
  expense: { projected: number; actual: number };
}

/**
 * The plan against what has been collected / spent, for a period.
 *
 *   - PROJECTED is the plan: every non-skipped row SCHEDULED in the period at its projected amount.
 *   - ACTUAL is what really moved: every COMPLETED row whose payment day (`actualDate`, else the
 *     scheduled day) is in the period, at its recorded actual (`??`: an actual of 0 is a real 0,
 *     a waived fee, not "fall back to the plan").
 *
 * So a bill planned for Feb 27 and paid on Mar 2 belongs to February's plan and March's actuals:
 * each side is bucketed by the date it is about.
 */
export const calculateProjectedVsActual = (
  transactions: readonly Transaction[],
  startDate: string,
  endDate: string
): ProjectedVsActual => {
  const result: ProjectedVsActual = {
    income: { projected: 0, actual: 0 },
    expense: { projected: 0, actual: 0 },
  };

  transactions.forEach((t) => {
    if (t.status === "skipped") return;
    const side = t.type === "income" ? result.income : result.expense;

    if (t.scheduledDate >= startDate && t.scheduledDate <= endDate) {
      side.projected += t.projectedAmount;
    }
    if (t.status === "completed") {
      const paidOn = t.actualDate || t.scheduledDate;
      if (paidOn >= startDate && paidOn <= endDate) {
        side.actual += t.actualAmount ?? t.projectedAmount;
      }
    }
  });

  return result;
};
