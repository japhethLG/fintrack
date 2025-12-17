import { IncomeFrequency } from "@/lib/types";

export const EXPENSE_TYPE_ICONS: Record<string, string> = {
  fixed: "event_repeat",
  variable: "trending_flat",
  cash_loan: "account_balance",
  credit_card: "credit_card",
  installment: "shopping_bag",
  "one-time": "receipt_long",
};

export const EXPENSE_TYPE_LABELS: Record<string, string> = {
  fixed: "Fixed Recurring",
  variable: "Variable",
  cash_loan: "Loan",
  credit_card: "Credit Card",
  installment: "Installment",
  "one-time": "One-time",
};

export const EXPENSE_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "priority", label: "Priority" },
  { value: "debt", label: "Debt" },
  { value: "fixed", label: EXPENSE_TYPE_LABELS.fixed },
  { value: "variable", label: EXPENSE_TYPE_LABELS.variable },
  { value: "cash_loan", label: EXPENSE_TYPE_LABELS.cash_loan },
  { value: "credit_card", label: EXPENSE_TYPE_LABELS.credit_card },
  { value: "installment", label: EXPENSE_TYPE_LABELS.installment },
  { value: "one-time", label: EXPENSE_TYPE_LABELS["one-time"] },
];

export const FREQUENCY_LABELS: Record<string, string> = {
  "one-time": "One-time",
  daily: "Daily",
  weekly: "Weekly",
  "bi-weekly": "Every 2 weeks",
  "semi-monthly": "Semi-monthly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export { getMonthlyMultiplier as getMonthlyExpenseMultiplier } from "@/lib/utils/frequencyUtils";
