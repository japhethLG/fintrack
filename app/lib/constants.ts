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
