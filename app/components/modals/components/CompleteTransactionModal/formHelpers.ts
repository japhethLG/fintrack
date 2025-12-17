import * as yup from "yup";

export interface CompleteTransactionFormValues {
  mode: "complete" | "skip" | "revert";
  actualAmount: string;
  actualDate: string;
  notes: string;
}

export const getDefaultValues = (
  projectedAmount: number,
  scheduledDate: string,
  existingNotes?: string
): CompleteTransactionFormValues => ({
  mode: "complete",
  actualAmount: projectedAmount.toString(),
  actualDate: scheduledDate,
  notes: existingNotes || "",
});

export const completeTransactionSchema = yup.object({
  mode: yup.string().oneOf(["complete", "skip", "revert"]).required(),
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
});
