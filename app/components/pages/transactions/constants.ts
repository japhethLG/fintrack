import { TransactionStatus } from "@/lib/types";

export const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "projected", label: "Projected" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "skipped", label: "Skipped" },
];

export const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "income", label: "Income" },
  { value: "expense", label: "Expenses" },
];

export const SORT_OPTIONS = [
  { value: "date", label: "Date" },
  { value: "amount", label: "Amount" },
];

export const STATUS_VARIANTS: Record<
  TransactionStatus,
  "success" | "warning" | "danger" | "default"
> = {
  completed: "success",
  pending: "warning",
  projected: "default",
  skipped: "danger",
};

export const STATUS_ICONS: Record<TransactionStatus, string> = {
  completed: "check_circle",
  pending: "schedule",
  projected: "event",
  skipped: "cancel",
};
