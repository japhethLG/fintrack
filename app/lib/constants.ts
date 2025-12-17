import { ExpenseCategory } from "@/lib/types";

// ============================================================================
// INCOME CATEGORIES
// ============================================================================

export const INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Investment",
  "Business",
  "Rental",
  "Government",
  "Gift",
  "Other",
];

// ============================================================================
// EXPENSE CATEGORIES
// ============================================================================

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "housing",
  "utilities",
  "transportation",
  "groceries",
  "dining",
  "entertainment",
  "healthcare",
  "insurance",
  "debt_payment",
  "subscriptions",
  "education",
  "personal",
  "savings",
  "other",
];

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  housing: "Housing",
  utilities: "Utilities",
  transportation: "Transportation",
  groceries: "Groceries",
  dining: "Dining",
  entertainment: "Entertainment",
  healthcare: "Healthcare",
  insurance: "Insurance",
  debt_payment: "Debt Payment",
  subscriptions: "Subscriptions",
  education: "Education",
  personal: "Personal",
  savings: "Savings",
  other: "Other",
};

export const CATEGORIES = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

// ============================================================================
// TRANSACTION STATUS COLORS
// ============================================================================

import { TransactionStatus } from "@/lib/types";

/** Badge variant for transaction status (used with Badge component) */
export const TRANSACTION_STATUS_BADGE_VARIANT: Record<
  TransactionStatus,
  "success" | "warning" | "default" | "danger"
> = {
  completed: "success",
  projected: "warning",
  skipped: "default",
};

/** Text color classes for transaction status */
export const TRANSACTION_STATUS_TEXT_COLOR: Record<TransactionStatus, string> = {
  completed: "text-success",
  projected: "text-warning",
  skipped: "text-gray-500",
};

/** Background color classes for transaction status */
export const TRANSACTION_STATUS_BG_COLOR: Record<TransactionStatus, string> = {
  completed: "bg-success/10",
  projected: "bg-warning/10",
  skipped: "bg-gray-700/30",
};
