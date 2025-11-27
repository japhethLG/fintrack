import {
  ExpenseType,
  IncomeFrequency,
  LoanCalculationType,
  CreditPaymentStrategy,
  MinimumPaymentMethod,
} from "@/lib/types";

export const EXPENSE_TYPES: { value: ExpenseType; label: string; description: string }[] = [
  {
    value: "fixed",
    label: "Fixed Recurring",
    description: "Same amount every time (Netflix, gym)",
  },
  { value: "variable", label: "Variable", description: "Amount varies (utilities, groceries)" },
  { value: "cash_loan", label: "Loan", description: "Amortized loan with interest" },
  { value: "credit_card", label: "Credit Card", description: "Revolving credit balance" },
  { value: "installment", label: "Installment", description: "Buy now, pay later (0% plans)" },
  { value: "one-time", label: "One-time", description: "Single expense" },
];

export const FREQUENCY_OPTIONS: { value: IncomeFrequency; label: string }[] = [
  { value: "one-time", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "bi-weekly", label: "Bi-weekly" },
  { value: "semi-monthly", label: "Semi-monthly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const LOAN_CALCULATION_TYPES: {
  value: LoanCalculationType;
  label: string;
  description: string;
}[] = [
  {
    value: "amortized",
    label: "Amortized (Standard)",
    description: "Fixed EMI, decreasing interest",
  },
  {
    value: "reducing_balance",
    label: "Reducing Balance",
    description: "Interest on remaining balance",
  },
  { value: "flat_rate", label: "Flat Rate", description: "Interest on original principal" },
];

export const PAYMENT_STRATEGIES: { value: CreditPaymentStrategy; label: string }[] = [
  { value: "minimum", label: "Minimum Payment" },
  { value: "fixed", label: "Fixed Amount" },
  { value: "full_balance", label: "Pay Full Balance" },
];

export const MINIMUM_PAYMENT_METHODS: { value: MinimumPaymentMethod; label: string }[] = [
  { value: "percent_only", label: "Percentage of Balance Only" },
  { value: "percent_plus_interest", label: "Percentage of Balance + Interest" },
];

export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export const WEEKEND_ADJUSTMENT_OPTIONS = [
  { value: "before", label: "Pay on Friday if weekend" },
  { value: "after", label: "Pay on Monday if weekend" },
  { value: "none", label: "No adjustment" },
];
