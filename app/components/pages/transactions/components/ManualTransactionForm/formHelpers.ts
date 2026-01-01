import * as yup from "yup";
import { Transaction, TransactionType, TransactionStatus } from "@/lib/types";

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
  const today = defaultDate || new Date().toISOString().split("T")[0];

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
    status: "completed", // Default to completed for today's date
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
 * Get smart default status based on selected date
 */
export const getSmartStatus = (date: string): TransactionStatus => {
  const today = new Date().toISOString().split("T")[0];
  return date <= today ? "completed" : "projected";
};
