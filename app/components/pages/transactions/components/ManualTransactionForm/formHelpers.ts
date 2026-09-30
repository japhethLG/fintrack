import * as yup from "yup";
import { Transaction, TransactionType, TransactionStatus } from "@/lib/types";
import { getTodayKey } from "@/lib/utils/dateUtils";

// ============================================================================
// FORM SCHEMA TYPES
// ============================================================================

export interface ManualTransactionFormValues {
  name: string;
  type: TransactionType;
  category: string;
  amount: string; // String for input, parse to number on submit
  scheduledDate: string;
  status: TransactionStatus;
  notes?: string;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const getDefaultValues = (
  editData?: Transaction,
  defaultDate?: string
): ManualTransactionFormValues => {
  const today = defaultDate || getTodayKey();

  if (editData) {
    return {
      name: editData.name,
      type: editData.type,
      category: editData.category,
      amount: (editData.actualAmount ?? editData.projectedAmount).toString(),
      scheduledDate: editData.scheduledDate,
      status: editData.status,
      notes: editData.notes || "",
    };
  }

  return {
    name: "",
    type: "expense",
    category: "other",
    amount: "",
    scheduledDate: today,
    status: "projected", // Default to projected
    notes: "",
  };
};

// ============================================================================
// VALIDATION SCHEMA
// ============================================================================

export const formSchema = yup.object({
  name: yup.string().required("Name is required").min(1, "Name is required"),
  type: yup.string().required("Type is required").oneOf(["income", "expense"]),
  category: yup.string().required("Category is required"),
  amount: yup
    .string()
    .required("Amount is required")
    .test("positive", "Amount must be greater than 0", (val) => parseFloat(val || "0") > 0),
  scheduledDate: yup.string().required("Date is required"),
  status: yup.string().required("Status is required").oneOf(["projected", "completed", "skipped"]),
  notes: yup.string().optional(),
});

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Transform form values to transaction data for submission
 */
export const transformToTransactionData = (
  values: ManualTransactionFormValues
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> => {
  const amount = parseFloat(values.amount);

  return {
    sourceType: "manual",
    sourceId: undefined,
    name: values.name.trim(),
    type: values.type,
    category: values.category,
    projectedAmount: amount,
    actualAmount: values.status === "completed" ? amount : undefined,
    scheduledDate: values.scheduledDate,
    actualDate: values.status === "completed" ? values.scheduledDate : undefined,
    status: values.status,
    notes: values.notes?.trim() || undefined,
    occurrenceId: undefined,
  };
};

/**
 * The changes an EDIT makes: only what the user actually changed, compared with what the
 * form showed when it opened. The form pre-fills "Amount" with the ACTUAL amount of a
 * completed row and "Date" with its scheduled date, so sending every field back rewrote
 * projectedAmount with the actual amount (losing the variance) and reset actualDate to the
 * scheduled date on a note-only save (UI-LIFE-06/06b). `undefined` fields are left alone by
 * the write path; an emptied note is sent as "" so it clears (UI-LIFE-08b).
 */
export const transformToTransactionUpdates = (
  values: ManualTransactionFormValues,
  initial: Transaction
): Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">> => {
  const shown = getDefaultValues(initial);
  const amount = parseFloat(values.amount);
  const updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">> = {};

  if (values.name.trim() !== shown.name) updates.name = values.name.trim();
  if (values.type !== shown.type) updates.type = values.type;
  if (values.category !== shown.category) updates.category = values.category;
  if ((values.notes ?? "").trim() !== (shown.notes ?? "")) updates.notes = (values.notes ?? "").trim();

  const amountChanged = amount !== parseFloat(shown.amount);
  const dateChanged = values.scheduledDate !== shown.scheduledDate;
  if (amountChanged) updates.projectedAmount = amount;
  if (dateChanged) updates.scheduledDate = values.scheduledDate;
  if (values.status !== shown.status) updates.status = values.status;

  if (values.status === "completed") {
    const becomingCompleted = initial.status !== "completed";
    if (amountChanged || becomingCompleted) updates.actualAmount = amount;
    if (dateChanged || becomingCompleted) updates.actualDate = values.scheduledDate;
  }
  return updates;
};

/**
 * Get smart default status based on selected date
 */
export const getSmartStatus = (date: string): TransactionStatus => {
  const today = getTodayKey();
  return date <= today ? "completed" : "projected";
};
