import { IncomeSourceType, IncomeFrequency } from "@/lib/types";

export const INCOME_SOURCE_TYPES: {
  value: IncomeSourceType;
  label: string;
  description: string;
}[] = [
  { value: "salary", label: "Salary", description: "Regular employment income" },
  { value: "freelance", label: "Freelance", description: "Contract or gig work" },
  { value: "business", label: "Business", description: "Self-employment income" },
  { value: "investment", label: "Investment", description: "Dividends, interest, gains" },
  { value: "rental", label: "Rental", description: "Property rental income" },
  { value: "government", label: "Government", description: "Benefits, pension, refunds" },
  { value: "gift", label: "Gift", description: "One-time gifts/inheritance" },
  { value: "other", label: "Other", description: "Other income sources" },
];

export const FREQUENCY_OPTIONS: { value: IncomeFrequency; label: string }[] = [
  { value: "one-time", label: "One-time" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "bi-weekly", label: "Bi-weekly (Every 2 weeks)" },
  { value: "semi-monthly", label: "Semi-monthly (e.g., 15th & 30th)" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
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

export const SOURCE_TYPE_ICONS: Record<string, string> = {
  salary: "work",
  freelance: "laptop",
  business: "storefront",
  investment: "trending_up",
  rental: "home",
  government: "account_balance",
  gift: "redeem",
  other: "attach_money",
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

export const getMonthlyMultiplier = (frequency: IncomeFrequency): number => {
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
