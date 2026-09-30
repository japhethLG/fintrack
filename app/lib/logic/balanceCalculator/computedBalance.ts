/**
 * Computed Balance Calculations
 * Source of truth for balance calculation based on initial balance + transactions
 */

import { Transaction } from "@/lib/types";
import { getUserProfile, updateUserBalance, recalculateBalance } from "@/lib/firebase/firestore";
import { cleanMoney, sumLedger } from "./ledgerMath";

/**
 * Calculate balance from initial balance + all completed transactions
 * This is the source of truth for balance calculation
 *
 * `transactions` must be the user's STORED rows (all of them). Never pass the
 * merged or date-windowed list from the UI: completed history outside the window
 * would silently drop out of the sum.
 *
 * @param initialBalance - User's starting balance baseline
 * @param transactions - All stored transactions to consider
 * @returns Computed current balance
 */
export const computeBalanceFromTransactions = (
  initialBalance: number,
  transactions: Transaction[]
): number => {
  const baseline = Number.isFinite(initialBalance) ? initialBalance : 0;
  return cleanMoney(baseline + sumLedger(transactions));
};

/**
 * Sync computed balance to user profile
 * Recalculates balance from initial balance + transactions and updates user profile
 *
 * Without `transactions` the rows are read from Firestore (every completed stored
 * row of the user): that is the form the app uses. Passing a list computes from
 * exactly that list (it must be ALL stored rows).
 *
 * @param userId - User ID
 * @param transactions - All stored transactions for the user (optional)
 * @returns The new computed balance
 */
export const syncComputedBalance = async (
  userId: string,
  transactions?: Transaction[]
): Promise<number> => {
  if (transactions === undefined) {
    return (await recalculateBalance(userId)).computed;
  }

  const profile = await getUserProfile(userId);
  if (!profile) throw new Error("User profile not found");

  const computedBalance = computeBalanceFromTransactions(profile.initialBalance, transactions);

  await updateUserBalance(userId, computedBalance);
  return computedBalance;
};
