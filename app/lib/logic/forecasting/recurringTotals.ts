/**
 * Recurring and period totals by OCCURRENCE COUNTING.
 *
 * Nothing here estimates with `amount x multiplier`: a total is the sum of the occurrences the
 * schedule really produces in the period (five Fridays in a month are five payments, a source that
 * has ended produces none), so the Dashboard, Calendar, Forecast and both managers can print the
 * same month and agree.
 *
 *   - `isIncomeSourceCurrent` / `isExpenseRuleCurrent`: a source or rule that is switched on AND
 *     still produces occurrences: not past its end date, not a repaid loan, not a settled card,
 *     not a fully paid installment plan. Only these count as "Active" and in any total.
 *   - `recurringMonthTotals`: the recurring rows of one month (completed rows at their recorded
 *     actual, pending rows at their plan, skipped rows nowhere).
 *   - `annualRecurringTotals`: the occurrences of the next 12 months.
 *   - `plannedTotals`: the PLAN of a period: every non-skipped row at its projected amount.
 *   - `totalDebt`: loan and card balances plus the unpaid instalments.
 */

import { ExpenseRule, IncomeSource, Transaction } from "@/lib/types";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { amountOf, rowDate } from "@/lib/logic/balanceCalculator/openItems";
import { dateFromDayNumber, dayNumberOfDate, formatDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";

/** Below this an outstanding balance counts as repaid (half a cent). */
const REPAID_EPSILON = 0.005;

/** Switched on and not past its end date. */
export const isIncomeSourceCurrent = (
  source: Pick<IncomeSource, "isActive" | "endDate">,
  today: string = getTodayKey()
): boolean => source.isActive && !(source.endDate && source.endDate < today);

/**
 * Switched on and still producing occurrences: not past its end date, and not a repaid loan, a
 * settled card or a fully paid installment plan (their schedules are empty).
 */
export const isExpenseRuleCurrent = (rule: ExpenseRule, today: string = getTodayKey()): boolean => {
  if (!rule.isActive) return false;
  if (rule.endDate && rule.endDate < today) return false;
  if (rule.expenseType === "cash_loan" && rule.loanConfig) {
    return rule.loanConfig.currentBalance > REPAID_EPSILON;
  }
  if (rule.expenseType === "credit_card" && rule.creditConfig) {
    return rule.creditConfig.currentBalance > REPAID_EPSILON;
  }
  if (rule.expenseType === "installment" && rule.installmentConfig) {
    return rule.installmentConfig.installmentsPaid < rule.installmentConfig.installmentCount;
  }
  return true;
};

const isRecurringIncome = (s: Pick<IncomeSource, "frequency">): boolean => s.frequency !== "one-time";
const isRecurringExpense = (r: Pick<ExpenseRule, "frequency" | "expenseType">): boolean =>
  r.frequency !== "one-time" && r.expenseType !== "one-time";

export interface Totals {
  income: number;
  expenses: number;
  net: number;
}

/**
 * The recurring income and expenses of one period (normally a calendar month) from the rows that
 * exist for it: completed rows at their recorded actual, pending rows at their plan, skipped rows
 * nowhere. One-time sources and rules, manual rows and rows of sources that are no longer current
 * are not recurring and not counted.
 *
 * @param transactions all rows (stored and projected) covering the period
 */
export const recurringPeriodTotals = (
  transactions: readonly Transaction[],
  incomeSources: readonly IncomeSource[],
  expenseRules: readonly ExpenseRule[],
  start: string,
  end: string,
  today: string = getTodayKey()
): Totals => {
  const incomeIds = new Set(
    incomeSources.filter((s) => isIncomeSourceCurrent(s, today) && isRecurringIncome(s)).map((s) => s.id)
  );
  const expenseIds = new Set(
    expenseRules.filter((r) => isExpenseRuleCurrent(r, today) && isRecurringExpense(r)).map((r) => r.id)
  );

  let income = 0;
  let expenses = 0;
  transactions.forEach((t) => {
    if (t.status === "skipped" || !t.sourceId) return;
    const date = rowDate(t);
    if (date < start || date > end) return;
    if (t.sourceType === "income_source" && incomeIds.has(t.sourceId)) income += amountOf(t);
    else if (t.sourceType === "expense_rule" && expenseIds.has(t.sourceId)) expenses += amountOf(t);
  });
  return { income, expenses, net: income - expenses };
};

/**
 * The recurring income and expenses of the next 12 months (today .. the day before the same day
 * next year): every occurrence the current sources and rules will produce, counted by the
 * projection engine (a daily source is 365 payments, a weekly one 52 or 53, ...).
 */
export const annualRecurringTotals = (
  incomeSources: readonly IncomeSource[],
  expenseRules: readonly ExpenseRule[],
  today: string = getTodayKey()
): Totals => {
  const from = parseDate(today);
  const nextYear = new Date(from.getFullYear() + 1, from.getMonth(), from.getDate());
  const to = dateFromDayNumber(dayNumberOfDate(nextYear) - 1);

  const sources = incomeSources.filter((s) => isIncomeSourceCurrent(s, today) && isRecurringIncome(s));
  const rules = expenseRules.filter((r) => isExpenseRuleCurrent(r, today) && isRecurringExpense(r));
  const projections = generateProjections(sources as IncomeSource[], rules as ExpenseRule[], from, to);

  let income = 0;
  let expenses = 0;
  projections.forEach((t) => {
    if (t.type === "income") income += t.projectedAmount;
    else expenses += t.projectedAmount;
  });
  return { income, expenses, net: income - expenses };
};

/**
 * The PLAN of a period: every non-skipped row scheduled in [start, end] at its projected amount.
 * (The same figure the Projected vs Actual widget calls "projected": there is one definition of
 * the plan, and a salary of 3,000 is 3,000 in a 31-day month, never 3,100.)
 */
export const plannedTotals = (
  transactions: readonly Transaction[],
  start: string,
  end: string
): Totals => {
  let income = 0;
  let expenses = 0;
  transactions.forEach((t) => {
    if (t.status === "skipped") return;
    if (t.scheduledDate < start || t.scheduledDate > end) return;
    if (t.type === "income") income += t.projectedAmount;
    else expenses += t.projectedAmount;
  });
  return { income, expenses, net: income - expenses };
};

/**
 * What is still owed on loans, cards and installment plans: outstanding loan and card balances plus
 * the unpaid instalments (remaining x instalment amount). Switched-off rules are not counted.
 */
export const totalDebt = (rules: readonly ExpenseRule[]): number =>
  rules.reduce((sum, rule) => {
    if (!rule.isActive) return sum;
    if (rule.loanConfig) return sum + rule.loanConfig.currentBalance;
    if (rule.creditConfig) return sum + rule.creditConfig.currentBalance;
    if (rule.installmentConfig) {
      const remaining = Math.max(
        rule.installmentConfig.installmentCount - rule.installmentConfig.installmentsPaid,
        0
      );
      return sum + remaining * rule.installmentConfig.installmentAmount;
    }
    return sum;
  }, 0);

/** First and last day (YYYY-MM-DD) of the calendar month containing `day`. */
export const monthBounds = (day: string): { start: string; end: string } => {
  const d = parseDate(day);
  return {
    start: formatDate(new Date(d.getFullYear(), d.getMonth(), 1)),
    end: formatDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
};
