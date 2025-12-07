/**
 * Computed Balance Calculations
 * Source of truth for balance calculation based on initial balance + transactions
 */

import { Transaction } from "@/lib/types";
import { getUserProfile, updateUserBalance } from "@/lib/firebase/firestore";

/**
 * Calculate balance from initial balance + all completed transactions
 * This is the source of truth for balance calculation
 * @param initialBalance - User's starting balance baseline
 * @param transactions - All transactions to consider
 * @returns Computed current balance
 */
export const computeBalanceFromTransactions = (
  initialBalance: number,
  transactions: Transaction[]
): number => {
  let balance = initialBalance;

  transactions.forEach((t) => {
    if (t.status === "completed") {
      const amount = t.actualAmount ?? t.projectedAmount;
      if (t.type === "income") {
        balance += amount;
      } else {
        balance -= amount;
      }
    }
  });

  return balance;
};

/**
 * Sync computed balance to user profile
 * Recalculates balance from initial balance + transactions and updates user profile
 * @param userId - User ID
 * @param transactions - All transactions for the user
 * @returns The new computed balance
 */
export const syncComputedBalance = async (
  userId: string,
  transactions: Transaction[]
): Promise<number> => {
  const profile = await getUserProfile(userId);
  if (!profile) throw new Error("User profile not found");

  const computedBalance = computeBalanceFromTransactions(profile.initialBalance, transactions);

  await updateUserBalance(userId, computedBalance);
  return computedBalance;
};
