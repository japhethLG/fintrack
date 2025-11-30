/**
 * Daily balance calculation logic
 */

import { Transaction, DayBalance } from "@/lib/types";
import { formatDate } from "@/lib/utils/dateUtils";
import { getBalanceStatus, getDaysBetween } from "./utils";

/**
 * Calculate daily balances over a date range
 * @param currentBalance - User's actual bank balance (includes completed transactions)
 * @param transactions - All transactions to consider
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @param warningThreshold - Balance threshold for warnings (default: 500)
 * @returns Map of date strings to DayBalance objects
 */
export const calculateDailyBalances = (
  currentBalance: number,
  transactions: Transaction[],
  startDate: Date,
  endDate: Date,
  warningThreshold: number = 500
): Map<string, DayBalance> => {
  const balances = new Map<string, DayBalance>();

  // Calculate the opening balance by "undoing" completed transactions.
  // Since currentBalance already includes completed transactions,
  // we need to reverse their effect to get the balance before any transactions.
  let openingBalance = currentBalance;
  transactions.forEach((t) => {
    if (t.status === "completed" || t.status === "partial") {
      const amount = t.actualAmount ?? t.projectedAmount;
      if (t.type === "income") {
        openingBalance -= amount; // Undo income (subtract it)
      } else {
        openingBalance += amount; // Undo expense (add it back)
      }
    }
  });

  // Group transactions by date
  const transactionsByDate = new Map<string, Transaction[]>();
  transactions.forEach((t) => {
    const dateKey = t.actualDate || t.scheduledDate;
    const existing = transactionsByDate.get(dateKey) || [];
    existing.push(t);
    transactionsByDate.set(dateKey, existing);
  });

  // Calculate balance for each day starting from the opening balance
  let runningBalance = openingBalance;
  const days = getDaysBetween(startDate, endDate);

  days.forEach((day) => {
    const dateKey = formatDate(day);
    const dayTransactions = transactionsByDate.get(dateKey) || [];

    // Calculate income and expenses for this day
    let income = 0;
    let expenses = 0;

    dayTransactions.forEach((t) => {
      // Use actual amount if completed, otherwise projected
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      // Skip skipped transactions
      if (t.status === "skipped") return;

      if (t.type === "income") {
        income += amount;
      } else {
        expenses += amount;
      }
    });

    const dayOpeningBalance = runningBalance;
    const closingBalance = runningBalance + income - expenses;

    balances.set(dateKey, {
      date: dateKey,
      openingBalance: dayOpeningBalance,
      closingBalance,
      totalIncome: income,
      totalExpenses: expenses,
      projectedIncome: 0,
      projectedExpenses: 0,
      transactions: dayTransactions,
      status: getBalanceStatus(closingBalance, warningThreshold),
    });

    runningBalance = closingBalance;
  });

  return balances;
};
