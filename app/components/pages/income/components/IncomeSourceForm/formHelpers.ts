import * as yup from "yup";
import {
  IncomeSource,
  IncomeSourceFormData,
  IncomeSourceType,
  IncomeFrequency,
  ScheduleConfig,
} from "@/lib/types";
import { getTodayKey } from "@/lib/utils/dateUtils";
import {
  buildScheduleConfig as buildSharedScheduleConfig,
  startDateParts,
  validateSchedule,
  type RuleIssue,
} from "@/lib/logic/ruleSchedule";

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
  /** Number, or the string a form input hands back. Follows the start date until the user changes it. */
  dayOfWeek: number | string;
  dayOfMonth: number | string;
  /** Carried through an edit untouched (no input): month of a yearly rule, weeks between bi-weekly payments. */
  monthOfYear?: number;
  intervalWeeks?: number;
  /** Carried through an edit untouched: editing must not reactivate a deactivated source. */
  isActive: boolean;
  category: string;
  notes: string;
  color: string;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const getDefaultValues = (
  initialData?: Partial<IncomeSourceFormValues>
): IncomeSourceFormValues => {
  // The start date is a LOCAL calendar day; the hidden schedule values default FROM IT, never from today.
  const startDate = initialData?.startDate || getTodayKey();
  const start = startDateParts(startDate);
  return {
    sourceType: initialData?.sourceType || "salary",
    name: initialData?.name || "",
    amount: initialData?.amount || "",
    isVariableAmount: initialData?.isVariableAmount || false,
    frequency: initialData?.frequency || "monthly",
    startDate,
    endDate: initialData?.endDate || "",
    hasEndDate: !!initialData?.endDate,
    weekendAdjustment: initialData?.weekendAdjustment || "before",
    specificDays: initialData?.specificDays || [15, 30],
    dayOfWeek: initialData?.dayOfWeek ?? start?.dayOfWeek ?? 0,
    dayOfMonth: initialData?.dayOfMonth ?? start?.dayOfMonth ?? 1,
    monthOfYear: initialData?.monthOfYear,
    intervalWeeks: initialData?.intervalWeeks,
    isActive: initialData?.isActive ?? true,
    category: initialData?.category || "Salary",
    notes: initialData?.notes || "",
    color: initialData?.color || "#22c55e",
  };
};

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

export const incomeSourceSchema = yup.object({
  sourceType: yup.string().required("Source type is required"),
  name: yup.string().required("Name is required").min(1, "Name is required"),
  amount: yup
    .string()
    .required("Amount is required")
    .test("positive", "Amount must be greater than 0", (value) => {
      // blank is reported by `required`; anything else must be a number above zero
      if (value === undefined || value === null || value.trim() === "") return true;
      return Number.isFinite(Number(value)) && Number(value) > 0;
    }),
  isVariableAmount: yup.boolean(),
  // Frequency, start date, end date, day of month and the semi-monthly days are checked together by
  // `validateSchedule` (see `collectIncomeIssues`); here they only need to exist.
  frequency: yup.string().required("Frequency is required"),
  startDate: yup.string().nullable().required("Start date is required"),
  endDate: yup.string().nullable().optional(),
  hasEndDate: yup.boolean(),
  weekendAdjustment: yup.string().oneOf(["before", "after", "none"]),
  specificDays: yup.array().of(yup.number()),
  dayOfWeek: yup.mixed().optional(),
  dayOfMonth: yup.mixed().optional(),
  category: yup.string().required("Category is required"),
  notes: yup.string().optional(),
  color: yup.string().optional(),
});

// ============================================================================
// UTILITIES
// ============================================================================

/** The `scheduleConfig` this form persists AND the Schedule Preview previews (the shared builder). */
export const buildScheduleConfig = (values: IncomeSourceFormValues): ScheduleConfig =>
  buildSharedScheduleConfig({
    frequency: values.frequency,
    startDate: values.startDate,
    specificDays: values.specificDays,
    dayOfWeek: values.dayOfWeek,
    dayOfMonth: values.dayOfMonth,
    monthOfYear: values.monthOfYear,
    intervalWeeks: values.intervalWeeks,
  });

/** Everything that must stop this source from being saved. Empty means saveable. */
export const collectIncomeIssues = (values: IncomeSourceFormValues): RuleIssue[] => {
  const issues: RuleIssue[] = validateSchedule({
    frequency: values.frequency,
    startDate: values.startDate,
    endDate: values.endDate,
    hasEndDate: values.hasEndDate,
    specificDays: values.specificDays,
    dayOfMonth: values.dayOfMonth,
  });
  const amount = Number(values.amount);
  if (!(values.amount?.trim() && Number.isFinite(amount) && amount > 0)) {
    issues.push({ field: "amount", message: "Enter an amount greater than 0." });
  }
  try {
    incomeSourceSchema.validateSync(values, { abortEarly: false });
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;
    for (const inner of error.inner) {
      const field = inner.path ?? "";
      if (!issues.some((i) => i.field === field)) issues.push({ field, message: inner.message });
    }
  }
  return issues;
};

/**
 * The document the wizard saves. `endDate` and `notes` are present-but-undefined when cleared, so an edit
 * removes them (see `editIncomeSourceAction`), and a ticked "Set End Date" with no date saves no end date.
 */
export const buildIncomePayload = (values: IncomeSourceFormValues): IncomeSourceFormData => ({
  name: values.name.trim(),
  sourceType: values.sourceType,
  amount: parseFloat(values.amount),
  isVariableAmount: values.isVariableAmount,
  frequency: values.frequency,
  startDate: values.startDate,
  endDate: values.hasEndDate && values.endDate ? values.endDate : undefined,
  scheduleConfig: buildScheduleConfig(values),
  weekendAdjustment: values.weekendAdjustment,
  category: values.category,
  notes: values.notes?.trim() || undefined,
  color: values.color,
  isActive: values.isActive,
});

/**
 * A stored source as the wizard's initial values. A schedule value the source does not store stays
 * undefined, so the form derives it from the start date, which is how the engine reads a rule without it.
 */
export const incomeSourceToFormValues = (
  source: IncomeSource
): Partial<IncomeSourceFormValues> => ({
  name: source.name,
  sourceType: source.sourceType,
  amount: source.amount.toString(),
  isVariableAmount: source.isVariableAmount,
  frequency: source.frequency,
  startDate: source.startDate,
  endDate: source.endDate || "",
  hasEndDate: !!source.endDate,
  weekendAdjustment: source.weekendAdjustment,
  specificDays: source.scheduleConfig?.specificDays || [15, 30],
  dayOfWeek: source.scheduleConfig?.dayOfWeek,
  dayOfMonth: source.scheduleConfig?.dayOfMonth,
  monthOfYear: source.scheduleConfig?.monthOfYear,
  intervalWeeks: source.scheduleConfig?.intervalWeeks,
  isActive: source.isActive,
  category: source.category,
  notes: source.notes || "",
  color: source.color || "#22c55e",
});
