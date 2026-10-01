/**
 * Period statistics calculations
 *
 * ONE definition of "what happened in a period", used by the Dashboard, the Calendar, the Forecast
 * and the managers, so the same month prints the same income, expenses and net everywhere:
 *
 *   - a row belongs to the period of `actualDate || scheduledDate`;
 *   - skipped rows are counted in `skippedCount` and in no amount;
 *   - a completed row is worth its recorded actual (`actualAmount ?? projectedAmount`), every other
 *     row its plan (an actual of 0 is a real 0).
 */

import { Transaction } from "@/lib/types";
import { amountOf, rowDate } from "@/lib/logic/balanceCalculator/openItems";

export interface PeriodSummary {
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  completedCount: number;
  skippedCount: number;
  completedIncomeCount: number;
  pendingIncomeCount: number;
  skippedIncomeCount: number;
  completedExpenseCount: number;
  pendingExpenseCount: number;
  skippedExpenseCount: number;
}

/**
 * Totals and counts for every row dated within [startDate, endDate] (YYYY-MM-DD, inclusive).
 */
export const summarizePeriod = (
  transactions: readonly Transaction[],
  startDate: string,
  endDate: string
): PeriodSummary => {
  const s: PeriodSummary = {
    income: 0,
    expenses: 0,
    net: 0,
    transactionCount: 0,
    completedCount: 0,
    skippedCount: 0,
    completedIncomeCount: 0,
    pendingIncomeCount: 0,
    skippedIncomeCount: 0,
    completedExpenseCount: 0,
    pendingExpenseCount: 0,
    skippedExpenseCount: 0,
  };

  transactions.forEach((t) => {
    const date = rowDate(t);
    if (date < startDate || date > endDate) return;

    s.transactionCount++;
    const isIncome = t.type === "income";

    if (t.status === "skipped") {
      s.skippedCount++;
      if (isIncome) s.skippedIncomeCount++;
      else s.skippedExpenseCount++;
      return;
    }

    if (t.status === "completed") {
      s.completedCount++;
      if (isIncome) s.completedIncomeCount++;
      else s.completedExpenseCount++;
    } else if (isIncome) {
      s.pendingIncomeCount++;
    } else {
      s.pendingExpenseCount++;
    }

    if (isIncome) s.income += amountOf(t);
    else s.expenses += amountOf(t);
  });

  s.net = s.income - s.expenses;
  return s;
};

/**
 * Savings rate in percent: (income - expenses) / income.
 * With no income the ratio is undefined: spending anything is then -100% (all of it unfunded) and
 * spending nothing is 0%, so a month of pure outflow is never mistaken for breaking even.
 */
export const savingsRatePercent = (income: number, expenses: number): number => {
  if (income > 0) return ((income - expenses) / income) * 100;
  return expenses > 0 ? -100 : 0;
};

/**
 * Percent change from `previous` to `current`, measured against the SIZE of the previous value
 * (|previous|), so the sign of the result is the direction of the move even when the previous value
 * is negative: a net flow of -1,500 after -1,000 is -50% (worse), not +50%.
 *
 * Returns `null` when there is no baseline to scale against (previous is 0 and current is not):
 * the change is "new", not a number. Both 0 is 0%.
 */
export const percentChange = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
};

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
  const { income, expenses, net, transactionCount, completedCount, skippedCount } = summarizePeriod(
    transactions,
    startDate,
    endDate
  );
  return { income, expenses, net, transactionCount, completedCount, skippedCount };
};
