import * as yup from "yup";
import { Transaction } from "@/lib/types";

// Mode for rule-based transactions
export type RuleBasedMode = "complete" | "skip" | "revert";

// Mode for manual transactions (edit is handled via separate modal)
export type ManualTransactionMode = "complete" | "skip" | "revert" | "delete";

export interface CompleteTransactionFormValues {
  mode: RuleBasedMode | ManualTransactionMode;
  actualAmount: string;
  actualDate: string;
  notes: string;
  // Manual transaction edit fields
  name?: string;
  category?: string;
  scheduledDate?: string;
}

export const getDefaultValues = (transaction: Transaction): CompleteTransactionFormValues => {
  const isManual = transaction.sourceType === "manual";
  const defaultMode = isManual ? "edit" : "complete";

  return {
    mode: defaultMode as any,
    actualAmount: (transaction.actualAmount ?? transaction.projectedAmount).toString(),
    actualDate: transaction.actualDate || transaction.scheduledDate,
    notes: transaction.notes || "",
    // Manual transaction fields
    name: isManual ? transaction.name : undefined,
    category: isManual ? transaction.category : undefined,
    scheduledDate: isManual ? transaction.scheduledDate : undefined,
  };
};

export const completeTransactionSchema = yup.object({
  mode: yup.string().oneOf(["complete", "skip", "revert", "delete"]).required(),
  actualAmount: yup.string().when("mode", {
    is: "complete",
    then: (schema) => schema.required("Amount is required"),
    otherwise: (schema) => schema.optional(),
  }),
  actualDate: yup.string().when("mode", {
    is: "complete",
    then: (schema) => schema.required("Date is required"),
    otherwise: (schema) => schema.optional(),
  }),
  notes: yup.string().optional(),
  // Manual transaction edit fields (not used in TransactionModal anymore)
  name: yup.string().optional(),
  category: yup.string().optional(),
  scheduledDate: yup.string().optional(),
});
