import * as yup from "yup";
import { IncomeSourceType, IncomeFrequency, ScheduleConfig } from "@/lib/types";

// ============================================================================
// FORM SCHEMA TYPES
// ============================================================================

export interface IncomeSourceFormValues {
  sourceType: IncomeSourceType;
  name: string;
  amount: string;
  isVariableAmount: boolean;
  frequency: IncomeFrequency;
  startDate: string;
  endDate: string;
  hasEndDate: boolean;
  weekendAdjustment: "before" | "after" | "none";
  specificDays: number[];
  dayOfWeek: number;
  dayOfMonth: number;
  category: string;
  notes: string;
  color: string;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const getDefaultValues = (
  initialData?: Partial<IncomeSourceFormValues>
): IncomeSourceFormValues => ({
  sourceType: initialData?.sourceType || "salary",
  name: initialData?.name || "",
  amount: initialData?.amount || "",
  isVariableAmount: initialData?.isVariableAmount || false,
  frequency: initialData?.frequency || "monthly",
  startDate: initialData?.startDate || new Date().toISOString().split("T")[0],
  endDate: initialData?.endDate || "",
  hasEndDate: !!initialData?.endDate,
  weekendAdjustment: initialData?.weekendAdjustment || "before",
  specificDays: initialData?.specificDays || [15, 30],
  dayOfWeek: initialData?.dayOfWeek ?? new Date().getDay(),
  dayOfMonth: initialData?.dayOfMonth ?? new Date().getDate(),
  category: initialData?.category || "Salary",
  notes: initialData?.notes || "",
  color: initialData?.color || "#22c55e",
});

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

export const incomeSourceSchema = yup.object({
  sourceType: yup.string().required("Source type is required"),
  name: yup.string().required("Name is required").min(1, "Name is required"),
  amount: yup.string().required("Amount is required"),
  isVariableAmount: yup.boolean(),
  frequency: yup.string().required("Frequency is required"),
  startDate: yup.string().required("Start date is required"),
  endDate: yup.string().optional(),
  hasEndDate: yup.boolean(),
  weekendAdjustment: yup.string().oneOf(["before", "after", "none"]),
  specificDays: yup.array().of(yup.number()),
  dayOfWeek: yup.number().min(0).max(6),
  dayOfMonth: yup.number().min(1).max(31),
  category: yup.string().required("Category is required"),
  notes: yup.string().optional(),
  color: yup.string().optional(),
});

// ============================================================================
// UTILITIES
// ============================================================================

export const buildScheduleConfig = (values: IncomeSourceFormValues): ScheduleConfig => {
  const config: ScheduleConfig = {};

  switch (values.frequency) {
    case "semi-monthly":
      config.specificDays = values.specificDays;
      break;
    case "weekly":
    case "bi-weekly":
      // Parse to number since FormSelect returns strings
      config.dayOfWeek = typeof values.dayOfWeek === "string" ? parseInt(values.dayOfWeek) : values.dayOfWeek;
      if (values.frequency === "bi-weekly") {
        config.intervalWeeks = 2;
      }
      break;
    case "monthly":
      config.dayOfMonth = values.dayOfMonth;
      break;
    case "quarterly":
    case "yearly":
      config.dayOfMonth = values.dayOfMonth;
      config.monthOfYear = new Date(values.startDate).getMonth();
      break;
  }

  return config;
};
