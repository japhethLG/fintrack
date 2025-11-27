import { BalanceStatus } from "@/lib/types";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const STATUS_COLORS: Record<BalanceStatus, string> = {
  safe: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export const STATUS_BG_COLORS: Record<BalanceStatus, string> = {
  safe: "bg-success/10 border-success/20",
  warning: "bg-warning/10 border-warning/20",
  danger: "bg-danger/10 border-danger/20",
};
