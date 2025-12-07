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
  deleteTransaction,
  deleteTransactionsBySource,
  subscribeToTransactions,
  subscribeToStoredTransactions,
} from "./transactions";

// ============================================================================
// BALANCE HISTORY OPERATIONS
// ============================================================================
export {
  saveBalanceSnapshot,
  getBalanceSnapshot,
  getBalanceHistory,
} from "./balanceHistory";

// ============================================================================
// ALERT OPERATIONS
// ============================================================================
export {
  createAlert,
  getAlerts,
  markAlertAsRead,
  dismissAlert,
  subscribeToAlerts,
} from "./alerts";

// ============================================================================
// MIGRATION UTILITIES
// ============================================================================
export {
  deleteProjectedTransactions,
  deleteAllUserData,
  deleteSelectiveUserData,
  migrateToInitialBalance,
} from "./migrations";

