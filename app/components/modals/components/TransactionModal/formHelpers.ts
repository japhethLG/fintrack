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
  const defaultMode = "complete"; // Default to complete for all transactions

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
    // a negative actual would CREDIT the account for an expense (UI-LIFE-09)
    then: (schema) =>
      schema
        .required("Amount is required")
        .test("non-negative", "Amount cannot be negative", (value) => !(parseFloat(value ?? "") < 0)),
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

/**
 * What to send as `notes` when saving from this dialog. Only `undefined` means "leave the
 * note alone"; an empty string CLEARS it. So a note the user emptied is sent as "" (it used
 * to be dropped, which made a note impossible to remove: UI-LIFE-08), text is sent as typed,
 * and an untouched empty field stays `undefined` so no empty note is invented.
 */
export const notesForSave = (typed: string | undefined, transaction: Transaction): string | undefined => {
  const trimmed = (typed ?? "").trim();
  if (trimmed !== "") return trimmed;
  return transaction.notes ? "" : undefined;
};
