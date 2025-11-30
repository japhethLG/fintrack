/**
 * Balance Reconciliation
 * Tools to detect and fix balance discrepancies between current and computed balance
 */

import { Transaction } from "@/lib/types";
import { getUserProfile } from "@/lib/firebase/firestore";
import { computeBalanceFromTransactions, syncComputedBalance } from "./computedBalance";

export interface ReconciliationReport {
  currentBalance: number;
  computedBalance: number;
  difference: number;
  affectedTransactions: Transaction[];
  canAutoFix: boolean;
}

/**
 * Generate a reconciliation report comparing current vs computed balance
 * @param userId - User ID
 * @param transactions - All transactions for the user
 * @returns Reconciliation report with difference and affected transactions
 */
export const generateReconciliationReport = async (
  userId: string,
  transactions: Transaction[]
): Promise<ReconciliationReport> => {
  const profile = await getUserProfile(userId);
  if (!profile) throw new Error("User profile not found");

  const computedBalance = computeBalanceFromTransactions(
    profile.initialBalance,
    transactions
  );

  const difference = profile.currentBalance - computedBalance;

  return {
    currentBalance: profile.currentBalance,
    computedBalance,
    difference,
    affectedTransactions: transactions.filter(
      (t) => t.status === "completed" || t.status === "partial"
    ),
    canAutoFix: true, // Can always fix by syncing to computed
  };
};

/**
 * Fix balance discrepancy by syncing to computed balance
 * Recalculates balance from initial balance + transactions and updates user profile
 * @param userId - User ID
 * @param transactions - All transactions for the user
 */
export const fixBalanceDiscrepancy = async (
  userId: string,
  transactions: Transaction[]
): Promise<void> => {
  await syncComputedBalance(userId, transactions);
};

