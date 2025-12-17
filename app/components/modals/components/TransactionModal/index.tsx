"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { useForm, Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Transaction } from "@/lib/types";
import { Button, Icon, Alert, Badge } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useFinancial } from "@/contexts/FinancialContext";
import {
  completeTransactionSchema,
  getDefaultValues,
  type CompleteTransactionFormValues,
} from "./formHelpers";

export interface IModalData {
  transaction: Transaction;
  onCloseModal?: () => void;
}

export interface IProps {
  closeModal: () => void;
  modalData: IModalData;
}

const TransactionModal: React.FC<IProps> = ({ closeModal, modalData }) => {
  const { transaction } = modalData;
  const router = useRouter();
  const { markTransactionComplete, markTransactionSkipped, revertTransactionToProjected } =
    useFinancial();
  const { formatCurrency, formatCurrencyWithSign, currencySymbol } = useCurrency();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const methods = useForm<CompleteTransactionFormValues>({
    defaultValues: getDefaultValues(
      transaction.projectedAmount,
      transaction.scheduledDate,
      transaction.notes
    ),
    resolver: yupResolver(completeTransactionSchema) as Resolver<CompleteTransactionFormValues>,
    mode: "onChange",
  });

  const { watch, setValue } = methods;
  const mode = watch("mode");
  const actualAmount = watch("actualAmount");

  const isIncome = transaction.type === "income";
  const variance = parseFloat(actualAmount || "0") - transaction.projectedAmount;
  const hasVariance = variance !== 0;
  const statusVariant: Record<
    Transaction["status"],
    React.ComponentProps<typeof Badge>["variant"]
  > = {
    completed: "success",
    skipped: "default",
    projected: "default",
  };

  const formatDisplayDate = (dateStr: string) => dayjs(dateStr).format("ddd, MMM D, YYYY");

  const handleSubmit = async (values: CompleteTransactionFormValues) => {
    setError(null);
    setIsSubmitting(true);

    try {
      if (values.mode === "complete") {
        await markTransactionComplete(transaction.id, {
          actualAmount: parseFloat(values.actualAmount),
          actualDate: values.actualDate,
          notes: values.notes?.trim() || undefined,
        });
      } else if (values.mode === "skip") {
        await markTransactionSkipped(transaction.id, values.notes?.trim() || undefined);
      } else if (values.mode === "revert") {
        await revertTransactionToProjected(transaction.id);
      }
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine if revert is available: non-manual, stored transaction
  const canRevert =
    transaction.sourceType !== "manual" &&
    !transaction.id.startsWith("proj_") &&
    (transaction.status === "completed" || transaction.status === "skipped");

  // Determine if we can link to source
  const hasSource =
    transaction.sourceId &&
    (transaction.sourceType === "income_source" || transaction.sourceType === "expense_rule");

  const handleViewSource = () => {
    closeModal();
    const basePath = transaction.sourceType === "income_source" ? "/income" : "/expenses";
    router.push(`${basePath}?source=${transaction.sourceId}`);
  };

  return (
    <div className="flex flex-col max-h-[80vh]">
      {/* Header - Fixed */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            isIncome ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
          )}
        >
          <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size={20} />
        </div>
        <div>
          <p className="font-bold text-white">{transaction.name}</p>
          <p className="text-gray-400 text-sm">{transaction.category}</p>
        </div>
      </div>

      <Form methods={methods} onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
        {/* Transaction Info - Fixed */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <Badge variant={statusVariant[transaction.status]} className="capitalize mt-1">
                {transaction.status}
              </Badge>
            </div>
            <div className="text-left">
              <p className="text-xs text-gray-400">Type</p>
              <p className="font-medium text-white capitalize">{isIncome ? "Income" : "Expense"}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Scheduled Date</p>
              <p className="text-white font-medium">
                {formatDisplayDate(transaction.scheduledDate)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Expected Amount</p>
              <p className={cn("font-bold", isIncome ? "text-success" : "text-danger")}>
                {isIncome ? "+" : "-"}
                {formatCurrency(transaction.projectedAmount)}
              </p>
            </div>
          </div>

          {(transaction.status === "completed" || transaction.status === "skipped") && (
            <div className="grid grid-cols-2 gap-4">
              {transaction.status === "completed" && (
                <>
                  <div>
                    <p className="text-xs text-gray-400">Actual Date</p>
                    <p className="text-white font-medium">
                      {formatDisplayDate(transaction.actualDate || transaction.scheduledDate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Actual Amount</p>
                    <p className={cn("font-bold", isIncome ? "text-success" : "text-danger")}>
                      {isIncome ? "+" : "-"}
                      {formatCurrency(transaction.actualAmount ?? transaction.projectedAmount)}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Source Link */}
        {hasSource && (
          <div className="flex w-full justify-between items-center mb-4 py-2 px-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="flex items-center gap-2 text-gray-400">
              <Icon name={isIncome ? "attach_money" : "receipt"} size="sm" />
              <span className="text-sm">
                From: <span className="text-white">{transaction.name}</span>
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleViewSource}
              className="text-primary hover:text-primary-light"
            >
              View {isIncome ? "Income Source" : "Expense Rule"}
              <Icon name="arrow_forward" size="sm" className="ml-1" />
            </Button>
          </div>
        )}

        {/* Status Warning */}
        {(transaction.status === "completed" || transaction.status === "skipped") && (
          <div className="mb-4">
            <Alert
              variant={transaction.status === "completed" ? "warning" : "info"}
              title={transaction.status === "completed" ? "Already completed" : "Currently skipped"}
            >
              {transaction.status === "completed"
                ? "Resubmitting will update the amount and adjust your balance; the previous adjustment will be reversed automatically."
                : "This transaction is skipped and does not impact your balance. Marking it complete will apply its amount to your balance."}
            </Alert>
          </div>
        )}

        {/* Mode Selection - Fixed */}
        <div className="flex gap-2 mb-4">
          <Button
            type="button"
            variant={mode === "complete" ? "primary" : "ghost"}
            className="flex-1"
            onClick={() => setValue("mode", "complete")}
          >
            <Icon name="check_circle" size="sm" className="mr-2" />
            Complete
          </Button>
          <Button
            type="button"
            variant={mode === "skip" ? "secondary" : "ghost"}
            className="flex-1"
            onClick={() => setValue("mode", "skip")}
          >
            <Icon name="skip_next" size="sm" className="mr-2" />
            Skip
          </Button>
          {canRevert && (
            <Button
              type="button"
              variant={mode === "revert" ? "danger" : "ghost"}
              className="flex-1"
              onClick={() => setValue("mode", "revert")}
            >
              <Icon name="undo" size="sm" className="mr-2" />
              Revert
            </Button>
          )}
        </div>

        {/* Scrollable Form Fields */}
        <div className="overflow-y-auto max-h-[200px] pr-1">
          {/* Complete Mode */}
          {mode === "complete" && (
            <div className="space-y-4">
              <FormInput
                inputName="actualAmount"
                type="number"
                label="Actual Amount"
                prefix={currencySymbol}
                placeholder="0.00"
              />

              {hasVariance && (
                <div
                  className={cn(
                    "p-3 rounded-lg text-sm",
                    variance > 0
                      ? isIncome
                        ? "bg-success/20 text-success"
                        : "bg-danger/20 text-danger"
                      : isIncome
                        ? "bg-danger/20 text-danger"
                        : "bg-success/20 text-success"
                  )}
                >
                  {formatCurrencyWithSign(variance)} variance from expected
                </div>
              )}

              <FormInput inputName="actualDate" type="date" label="Actual Date" />
            </div>
          )}

          {/* Skip Mode */}
          {mode === "skip" && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-4">
              <p className="text-warning text-sm">
                Skipping will mark this transaction as not completed. The projected amount will not
                affect your balance.
              </p>
            </div>
          )}

          {/* Revert Mode */}
          {mode === "revert" && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-4 mb-4">
              <p className="text-danger text-sm">
                This will delete this transaction and regenerate it as a projection from the source
                rule. If you had moved this transaction to a different date, that date will be
                preserved.
                {transaction.status === "completed" &&
                  " Your balance will be adjusted to reverse this transaction's impact."}
              </p>
            </div>
          )}

          {/* Notes */}
          <div className="mt-4">
            <FormInput inputName="notes" label="Notes (Optional)" placeholder="Add a note..." />
          </div>

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-3 bg-danger/20 border border-danger/30 rounded-lg text-danger text-sm">
              {error}
            </div>
          )}
        </div>
        {/* End Scrollable Form Fields */}

        {/* Actions - Fixed at bottom */}
        <div className="flex gap-3 pt-4 border-t border-gray-800 flex-shrink-0 mt-4">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={closeModal}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={mode === "skip" ? "secondary" : mode === "revert" ? "danger" : "primary"}
            className="flex-1"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "Processing..."
              : mode === "complete"
                ? "Mark Complete"
                : mode === "revert"
                  ? "Revert to Projected"
                  : "Skip Transaction"}
          </Button>
        </div>
      </Form>
    </div>
  );
};

export default TransactionModal;
