/**
 * Firestore Operations
 * Centralized exports for all Firestore database operations
 *
 * This file serves as the main entry point for Firestore operations,
 * organized by domain entity.
 */

// ============================================================================
// UTILITIES
// ============================================================================
export { removeUndefined } from "./utils";

// ============================================================================
// USER PROFILE OPERATIONS
// ============================================================================
export {
  createUserProfile,
  getUserProfile,
  updateUserProfile,
  updateUserBalance,
  adjustUserBalance,
  BALANCE_MODEL_VERSION,
  subscribeToUserProfile,
  deleteUserProfile,
} from "./users";

// ============================================================================
// INCOME SOURCE OPERATIONS
// ============================================================================
export {
  addIncomeSource,
  getIncomeSources,
  getIncomeSource,
  updateIncomeSource,
  deleteIncomeSource,
  setIncomeSourceOverride,
  patchIncomeSourceOverride,
  removeIncomeSourceOverride,
  subscribeToIncomeSources,
} from "./incomeSources";

// ============================================================================
// EXPENSE RULE OPERATIONS
// ============================================================================
export {
  addExpenseRule,
  getExpenseRules,
  getExpenseRule,
  updateExpenseRule,
  deleteExpenseRule,
  setExpenseRuleOverride,
  patchExpenseRuleOverride,
  removeExpenseRuleOverride,
  updateLoanBalance,
  updateCreditBalance,
  updateInstallmentProgress,
  subscribeToExpenseRules,
} from "./expenseRules";

// ============================================================================
// TRANSACTION OPERATIONS
// ============================================================================
export {
  addTransaction,
  addTransactionsBatch,
  getTransactions,
  getTransaction,
  updateTransaction,
  completeTransaction,
  skipTransaction,
  revertToProjected,
  completeOccurrence,
  skipOccurrence,
  addTransactionWithBalance,
  updateManualTransactionWithBalance,
  deleteTransactionWithBalance,
  deleteTransaction,
  deleteTransactionsBySource,
  subscribeToTransactions,
  subscribeToStoredTransactions,
} from "./transactions";

// ============================================================================
// LEDGER: BALANCE TOOLS
// ============================================================================
export {
  getCompletedTransactions,
  recalculateBalance,
  setInitialBalance,
  overrideCurrentBalance,
} from "./balance";
export { LedgerOwnershipError, occurrenceRowId } from "./ledger";

export type { OccurrenceBase } from "./transactions";

// ============================================================================
// BALANCE HISTORY OPERATIONS
// ============================================================================
export {
  saveBalanceSnapshot,
  getBalanceSnapshot,
  getBalanceHistory,
  countBalanceHistory,
} from "./balanceHistory";

// ============================================================================
// ALERT OPERATIONS
// ============================================================================
export { createAlert, getAlerts, markAlertAsRead, dismissAlert, subscribeToAlerts } from "./alerts";

// ============================================================================
// MIGRATION UTILITIES
// ============================================================================
export {
  deleteProjectedTransactions,
  deleteAllUserData,
  deleteSelectiveUserData,
  deleteAccountData,
  ResetIncompleteError,
  migrateToInitialBalance,
  migrateLoanInstallmentDayOfMonth,
  migratePendingToOverrides,
} from "./migrations";
