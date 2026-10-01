/**
 * The ONE wording for a rule's frequency and weekend handling, used by the income and expense wizards
 * (options, review step) and the detail cards, so the same setting never reads two ways.
 */

import type { IncomeFrequency } from "@/lib/types";

export type WeekendAdjustment = "before" | "after" | "none";

/** What the Weekend Adjustment select offers, and what every summary of the setting says. */
export const WEEKEND_ADJUSTMENT_LABELS: Record<WeekendAdjustment, string> = {
  before: "Pay on Friday if weekend",
  after: "Pay on Monday if weekend",
  none: "No adjustment",
};

export const weekendAdjustmentLabel = (adjustment: string | undefined | null): string =>
  WEEKEND_ADJUSTMENT_LABELS[(adjustment as WeekendAdjustment) ?? "none"] ??
  WEEKEND_ADJUSTMENT_LABELS.none;

/** A frequency as a short noun phrase on cards and review steps. */
export const FREQUENCY_SHORT_LABELS: Record<IncomeFrequency, string> = {
  "one-time": "One-time",
  daily: "Daily",
  weekly: "Weekly",
  "bi-weekly": "Every 2 weeks",
  "semi-monthly": "Semi-monthly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

export const frequencyLabel = (frequency: string): string =>
  FREQUENCY_SHORT_LABELS[frequency as IncomeFrequency] ?? frequency;
