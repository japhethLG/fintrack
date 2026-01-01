import { TransactionType, TransactionStatus } from "@/lib/types";

// ============================================================================
// TRANSACTION TYPE OPTIONS
// ============================================================================

export const TRANSACTION_TYPE_OPTIONS = [
  { value: "income" as TransactionType, label: "Income" },
  { value: "expense" as TransactionType, label: "Expense" },
];

// ============================================================================
// STATUS OPTIONS
// ============================================================================

export const STATUS_OPTIONS = [
  {
    value: "completed" as TransactionStatus,
    label: "Completed",
    description: "Transaction has occurred",
  },
  {
    value: "projected" as TransactionStatus,
    label: "Projected",
    description: "Planned for future",
  },
  {
    value: "skipped" as TransactionStatus,
    label: "Skipped",
    description: "Cancelled/won't happen",
  },
];

// ============================================================================
// CATEGORY OPTIONS
// ============================================================================

export const INCOME_CATEGORY_OPTIONS = [
  { value: "salary", label: "Salary" },
  { value: "freelance", label: "Freelance" },
  { value: "business", label: "Business" },
  { value: "investment", label: "Investment" },
  { value: "rental", label: "Rental Income" },
  { value: "government", label: "Government Benefits" },
  { value: "gift", label: "Gift/Donation" },
  { value: "other", label: "Other Income" },
];

export const EXPENSE_CATEGORY_OPTIONS = [
  { value: "housing", label: "Housing" },
  { value: "utilities", label: "Utilities" },
  { value: "transportation", label: "Transportation" },
  { value: "groceries", label: "Groceries" },
  { value: "dining", label: "Dining Out" },
  { value: "entertainment", label: "Entertainment" },
  { value: "healthcare", label: "Healthcare" },
  { value: "insurance", label: "Insurance" },
  { value: "debt_payment", label: "Debt Payment" },
  { value: "subscriptions", label: "Subscriptions" },
  { value: "education", label: "Education" },
  { value: "personal", label: "Personal Care" },
  { value: "savings", label: "Savings" },
  { value: "other", label: "Other Expense" },
];
