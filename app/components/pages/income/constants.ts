import { IncomeSourceType, IncomeFrequency } from "@/lib/types";
import { FREQUENCY_SHORT_LABELS, WEEKEND_ADJUSTMENT_LABELS } from "@/lib/utils/ruleLabels";

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

export const INCOME_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  ...INCOME_SOURCE_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
  })),
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

export const WEEKEND_ADJUSTMENT_OPTIONS = (["before", "after", "none"] as const).map((value) => ({
  value,
  label: WEEKEND_ADJUSTMENT_LABELS[value],
}));

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

export const FREQUENCY_LABELS: Record<string, string> = FREQUENCY_SHORT_LABELS;

