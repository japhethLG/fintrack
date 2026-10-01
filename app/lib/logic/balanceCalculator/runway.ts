/**
 * Cash runway and the next crunch: ONE walk, two readings.
 *
 * Both start from the realized balance, fold the overdue expenses into day 0 (see openItems.ts, D5),
 * then add every projected row day by day (income before expenses within a day) and look at the
 * END-OF-DAY balance. `getRunway`, `getNextCrunch` and the health score's runway all read this
 * walk, so they can never disagree about the first negative date.
 *
 * Completed rows are never in the walk: their effect is already inside the realized balance.
 *
 * Horizon: RISK_HORIZON_DAYS (90). The default projection window always covers at least the next 90
 * days (it ends on the last day of the month three months ahead), so "no run-out in 90 days" is a
 * statement about data the app really has, and the "90+ days" label says exactly that. A longer
 * horizon would over-state the runway once the generated rows run out.
 */

import { Transaction } from "@/lib/types";
import { dateFromDayNumber, dayNumberOfDate, formatDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import { amountOf, collectOpenItems, rowDate } from "./openItems";

/** Days the risk views look ahead. Also the label: "90+ days" means "no run-out within it". */
export const RISK_HORIZON_DAYS = 90;

export interface RiskWalk {
  today: string;
  horizonDays: number;
  /** Realized balance the walk started from. */
  startBalance: number;
  /** Overdue expenses folded into day 0. */
  overdueOutflow: number;
  /** First day whose end-of-day balance is negative (or today when already overdrawn). */
  firstNegative: { index: number; date: string; balance: number } | null;
  /** The realized balance is already below zero (nothing has to be due for that to be true). */
  alreadyOverdrawn: boolean;
  /** Lowest end-of-day balance in the horizon. */
  lowestBalance: number;
}

/**
 * Walk the balance forward `horizonDays` days from `today`.
 * @param transactions all rows (completed and skipped rows are ignored)
 */
export const walkRisk = (
  currentBalance: number,
  transactions: readonly Transaction[],
  horizonDays: number = RISK_HORIZON_DAYS,
  today: string = getTodayKey()
): RiskWalk => {
  const open = collectOpenItems(transactions, today);

  // Net flow per day with income credited first: the day is judged by its closing balance.
  const flowByDay = new Map<string, number>();
  for (const t of open.upcoming) {
    const key = rowDate(t);
    const amount = amountOf(t);
    flowByDay.set(key, (flowByDay.get(key) ?? 0) + (t.type === "income" ? amount : -amount));
  }

  const startDay = dayNumberOfDate(parseDate(today));
  const alreadyOverdrawn = currentBalance < 0;
  let balance = currentBalance - open.overdueOutflow;
  let lowest = Math.min(currentBalance, balance);
  let firstNegative: RiskWalk["firstNegative"] = null;

  for (let i = 0; i < horizonDays; i++) {
    const date = formatDate(dateFromDayNumber(startDay + i));
    balance += flowByDay.get(date) ?? 0;
    if (balance < lowest) lowest = balance;
    if (firstNegative === null && balance < 0) {
      firstNegative = { index: i, date, balance };
    }
  }

  if (alreadyOverdrawn) {
    // Overdrawn right now: report today, with the deeper of "now" and "end of today".
    const day0 = firstNegative && firstNegative.index === 0 ? firstNegative.balance : null;
    const deepest = day0 === null ? currentBalance : Math.min(currentBalance, day0);
    firstNegative = { index: 0, date: today, balance: deepest };
  }

  return {
    today,
    horizonDays,
    startBalance: currentBalance,
    overdueOutflow: open.overdueOutflow,
    firstNegative,
    alreadyOverdrawn,
    lowestBalance: lowest,
  };
};

/**
 * Calculate how many days until balance runs out
 * @param currentBalance - Realized account balance
 * @param transactions - All transactions
 * @param maxDays - Horizon in days (default: RISK_HORIZON_DAYS)
 * @returns days until the first negative end-of-day balance (0 = today, including an account that
 *          is already overdrawn) and the date, or `maxDays` and null when it never goes negative
 */
export const getRunway = (
  currentBalance: number,
  transactions: readonly Transaction[],
  maxDays: number = RISK_HORIZON_DAYS,
  today: string = getTodayKey()
): { days: number; runOutDate: string | null } => {
  const walk = walkRisk(currentBalance, transactions, maxDays, today);
  return {
    days: walk.firstNegative ? walk.firstNegative.index : maxDays,
    runOutDate: walk.firstNegative ? walk.firstNegative.date : null,
  };
};

/**
 * Find the next date when balance will go negative
 * @param currentBalance - Realized account balance
 * @param transactions - All transactions
 * @param maxDays - Horizon in days (default: RISK_HORIZON_DAYS, the same as `getRunway`)
 * @returns the first negative date and how far below zero the account is then (the deepest of
 *          "now" and "end of that day" for an account that is already overdrawn), or null
 */
export const getNextCrunch = (
  currentBalance: number,
  transactions: readonly Transaction[],
  maxDays: number = RISK_HORIZON_DAYS,
  today: string = getTodayKey()
): { date: string; shortfall: number } | null => {
  const walk = walkRisk(currentBalance, transactions, maxDays, today);
  if (!walk.firstNegative) return null;
  return { date: walk.firstNegative.date, shortfall: Math.abs(walk.firstNegative.balance) };
};
