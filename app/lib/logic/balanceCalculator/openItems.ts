/**
 * What is still OPEN, and how the risk views treat it.
 *
 * THE MODEL (decision D5, docs/audit/fixes/display-numbers.md)
 *
 * The realized balance `B` is `users/{uid}.currentBalance` = initialBalance + SUM(completed rows).
 * Only completing a row moves it. Every other row is OPEN:
 *
 *   - OVERDUE  : status "projected" and dated BEFORE today. Nobody has paid / received it yet.
 *   - UPCOMING : status "projected" and dated today or later.
 *   - skipped / completed rows are not open.
 *
 * Overdue items do NOT move the realized balance, but the risk views must not pretend they are not
 * owed. Every projection (calendar, runway, next crunch, bill coverage, health runway) therefore
 * starts from the same place:
 *
 *   day-0 balance = B  -  (sum of overdue EXPENSES)  +  (today's income)  -  (today's expenses)
 *
 * Overdue INCOME is not credited: money that has not arrived is not money you can spend (it still
 * appears, flagged, on its own date). Within one day, income is credited before expenses: a day is
 * judged by its END-OF-DAY balance, so paying a bill from a paycheque that lands the same day is
 * covered. The same rule orders same-day rows everywhere (`compareOpenRows`) so the answer never
 * depends on which list a row came from.
 *
 * Overdue rows are only tracked back to the start of the DEFAULT projection window (the first day
 * of the month two months ago). That is the oldest day the app generates projections for without
 * the user browsing, and anchoring on it keeps every risk number independent of how far the user
 * has scrolled the calendar (the view window only ever grows).
 */

import { Transaction } from "@/lib/types";
import { formatDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";

/** The date a row is shown on and counted at. */
export const rowDate = (t: Pick<Transaction, "actualDate" | "scheduledDate">): string =>
  t.actualDate || t.scheduledDate;

/** What a row is worth: the recorded actual once completed, else the plan. */
export const amountOf = (
  t: Pick<Transaction, "status" | "actualAmount" | "projectedAmount">
): number => (t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount);

/** First day the default projection window covers: the 1st of the month two months before `today`. */
export const defaultWindowStart = (today: string): string => {
  const d = parseDate(today);
  return formatDate(new Date(d.getFullYear(), d.getMonth() - 2, 1));
};

/** A still-projected row dated before today. */
export const isOverdue = (
  t: Pick<Transaction, "status" | "actualDate" | "scheduledDate">,
  today: string = getTodayKey()
): boolean => t.status === "projected" && rowDate(t) < today;

/**
 * Same-day order: income before expenses, then by name, then by id (stable and explainable;
 * never "whichever list the row happened to come from").
 */
export const compareSameDay = (a: Transaction, b: Transaction): number => {
  if (a.type !== b.type) return a.type === "income" ? -1 : 1;
  return (a.name ?? "").localeCompare(b.name ?? "") || (a.id ?? "").localeCompare(b.id ?? "");
};

/** Date ascending, then `compareSameDay`. */
export const compareOpenRows = (a: Transaction, b: Transaction): number => {
  const da = rowDate(a);
  const db = rowDate(b);
  if (da !== db) return da < db ? -1 : 1;
  return compareSameDay(a, b);
};

export interface OpenItems {
  today: string;
  /** Overdue rows (income and expenses), oldest first. Income is listed, never credited. */
  overdue: Transaction[];
  /** Sum of the overdue EXPENSES: what is owed right now. */
  overdueOutflow: number;
  /** Projected rows dated today or later, in `compareOpenRows` order. */
  upcoming: Transaction[];
}

/** Split the open rows into overdue and upcoming. Pure; the caller supplies `today`. */
export const collectOpenItems = (
  transactions: readonly Transaction[],
  today: string = getTodayKey()
): OpenItems => {
  const lookback = defaultWindowStart(today);
  const overdue: Transaction[] = [];
  const upcoming: Transaction[] = [];
  let overdueOutflow = 0;

  for (const t of transactions) {
    if (t.status !== "projected") continue;
    const date = rowDate(t);
    if (date < today) {
      if (date < lookback) continue;
      overdue.push(t);
      if (t.type !== "income") overdueOutflow += t.projectedAmount;
    } else {
      upcoming.push(t);
    }
  }

  overdue.sort(compareOpenRows);
  upcoming.sort(compareOpenRows);
  return { today, overdue, overdueOutflow, upcoming };
};
