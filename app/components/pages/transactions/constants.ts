import dayjs from "dayjs";
import { DateRange } from "@/components/common/DateRangePicker";
import { TransactionStatus } from "@/lib/types";
import { TRANSACTION_STATUS_BADGE_VARIANT } from "@/lib/constants";

export const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "projected", label: "Projected" },
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

export const ORDER_OPTIONS = [
  { value: "asc", label: "Ascending" },
  { value: "desc", label: "Descending" },
];

// Re-export centralized status variants for backward compatibility
export const STATUS_VARIANTS = TRANSACTION_STATUS_BADGE_VARIANT;

export const STATUS_ICONS: Record<TransactionStatus, string> = {
  completed: "check_circle",
  projected: "event",
  skipped: "cancel",
};

export const DATE_RANGE_PRESETS: { value: string; label: string; range: DateRange }[] = [
  {
    value: "thisMonth",
    label: "This Month",
    range: [dayjs().startOf("month"), dayjs().endOf("month")],
  },
  {
    value: "last3Months",
    label: "Last 3 Months",
    range: [dayjs().subtract(2, "month").startOf("month"), dayjs().endOf("month")],
  },
  {
    value: "last6Months",
    label: "Last 6 Months",
    range: [dayjs().subtract(5, "month").startOf("month"), dayjs().endOf("month")],
  },
  {
    value: "last12Months",
    label: "Last 12 Months",
    range: [dayjs().subtract(11, "month").startOf("month"), dayjs().endOf("month")],
  },
  {
    value: "next3Months",
    label: "Next 3 Months",
    range: [dayjs().startOf("month"), dayjs().add(3, "month").endOf("month")],
  },
  {
    value: "allTime",
    label: "All Time (2y back / 2y ahead)",
    range: [dayjs().subtract(2, "year").startOf("year"), dayjs().add(2, "year").endOf("year")],
  },
];
