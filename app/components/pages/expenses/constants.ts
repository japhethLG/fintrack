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

export const getMonthlyExpenseMultiplier = (frequency: IncomeFrequency): number => {
  switch (frequency) {
    case "daily":
      return 30;
    case "weekly":
      return 52 / 12;
    case "bi-weekly":
      return 26 / 12;
    case "semi-monthly":
      return 2;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "yearly":
      return 1 / 12;
    case "one-time":
    default:
      return 0;
  }
};
