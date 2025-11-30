/**
 * Cash runway and financial sustainability calculations
 */

import { Transaction } from "@/lib/types";
import { formatDate, addDays } from "@/lib/utils/dateUtils";

/**
 * Calculate how many days until balance runs out
 * @param currentBalance - Current account balance
 * @param transactions - All transactions
 * @param maxDays - Maximum days to project (default: 365)
 * @returns Object with days remaining and projected run-out date
 */
export const getRunway = (
  currentBalance: number,
  transactions: Transaction[],
  maxDays: number = 365
): { days: number; runOutDate: string | null } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let balance = currentBalance;
  let daysUntilEmpty = 0;
  let runOutDate: string | null = null;

  for (let i = 0; i < maxDays; i++) {
    const currentDate = addDays(today, i);
    const dateKey = formatDate(currentDate);

    // Find transactions for this day
    const dayTransactions = transactions.filter((t) => {
      const txDate = t.actualDate || t.scheduledDate;
      return txDate === dateKey && t.status !== "skipped";
    });

    dayTransactions.forEach((t) => {
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      if (t.type === "income") {
        balance += amount;
      } else {
        balance -= amount;
      }
    });

    if (balance < 0 && runOutDate === null) {
      runOutDate = dateKey;
      daysUntilEmpty = i;
      break;
    }
  }

  return {
    days: runOutDate ? daysUntilEmpty : maxDays,
    runOutDate,
  };
};

/**
 * Find the next date when balance will go negative
 * @param currentBalance - Current account balance
 * @param transactions - All transactions
 * @param maxDays - Maximum days to look ahead (default: 90)
 * @returns Object with date and shortfall amount, or null if no crunch period
 */
export const getNextCrunch = (
  currentBalance: number,
  transactions: Transaction[],
  maxDays: number = 90
): { date: string; shortfall: number } | null => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let balance = currentBalance;

  for (let i = 0; i < maxDays; i++) {
    const currentDate = addDays(today, i);
    const dateKey = formatDate(currentDate);

    const dayTransactions = transactions.filter((t) => {
      const txDate = t.actualDate || t.scheduledDate;
      return txDate === dateKey && t.status !== "skipped";
    });

    let dayExpenses = 0;
    let dayIncome = 0;

    dayTransactions.forEach((t) => {
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      if (t.type === "income") {
        dayIncome += amount;
      } else {
        dayExpenses += amount;
      }
    });

    balance = balance + dayIncome - dayExpenses;

    if (dayExpenses > 0 && balance < 0) {
      return {
        date: dateKey,
        shortfall: Math.abs(balance),
      };
    }
  }

  return null;
};
