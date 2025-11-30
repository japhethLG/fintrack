"use client";

import React, { useState } from "react";
import { useForm, Resolver } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Transaction, CompleteTransactionData } from "@/lib/types";
import { Button, Card, Icon, Alert } from "@/components/common";
import { Form, FormInput } from "@/components/formElements";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import {
  completeTransactionSchema,
  getDefaultValues,
  type CompleteTransactionFormValues,
} from "./formHelpers";

interface IProps {
  transaction: Transaction;
  onComplete: (data: CompleteTransactionData) => Promise<void>;
  onSkip: (notes?: string) => Promise<void>;
  onPartial?: (amount: number, notes?: string) => Promise<void>;
  onClose: () => void;
}

const CompleteTransactionModal: React.FC<IProps> = ({
  transaction,
  onComplete,
  onSkip,
  onPartial,
  onClose,
}) => {
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

  const handleSubmit = async (values: CompleteTransactionFormValues) => {
    setError(null);
    setIsSubmitting(true);

    try {
      if (values.mode === "complete") {
        await onComplete({
          actualAmount: parseFloat(values.actualAmount),
          actualDate: values.actualDate,
          notes: values.notes?.trim() || undefined,
        });
      } else if (values.mode === "skip") {
        await onSkip(values.notes?.trim() || undefined);
      } else if (values.mode === "partial" && onPartial) {
        await onPartial(parseFloat(values.actualAmount), values.notes?.trim() || undefined);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <Card padding="lg" className="w-full max-w-lg animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                isIncome ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
              )}
            >
              <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{transaction.name}</h2>
              <p className="text-gray-400 text-sm">{transaction.category}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="close" size="sm" />}
            onClick={onClose}
          />
        </div>

        {/* Transaction Info */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Scheduled Date</p>
              <p className="text-white font-medium">
                {new Date(transaction.scheduledDate).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
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
        </div>

        {/* Resubmission Warning */}
        {(transaction.status === "completed" || transaction.status === "partial") && (
          <div className="mb-6">
            <Alert variant="warning">
              This transaction is already {transaction.status}. Resubmitting will update the amount and
              adjust your balance accordingly. The previous adjustment will be reversed automatically.
            </Alert>
          </div>
        )}

        <Form methods={methods} onSubmit={handleSubmit}>
          {/* Mode Selection */}
          <div className="flex gap-2 mb-6">
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
            {onPartial && (
              <Button
                type="button"
                variant={mode === "partial" ? "secondary" : "ghost"}
                className="flex-1"
                onClick={() => setValue("mode", "partial")}
              >
                <Icon name="pending" size="sm" className="mr-2" />
                Partial
              </Button>
            )}
          </div>

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

          {/* Partial Mode */}
          {mode === "partial" && (
            <div className="space-y-4">
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
                <p className="text-primary text-sm">
                  Record a partial payment. The remaining balance will be tracked.
                </p>
              </div>
              <FormInput
                inputName="actualAmount"
                type="number"
                label="Amount Paid"
                prefix={currencySymbol}
                placeholder="0.00"
              />
              <div className="text-sm text-gray-400">
                Remaining:{" "}
                {formatCurrency(transaction.projectedAmount - parseFloat(actualAmount || "0"))}
              </div>
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

          {/* Actions */}
          <div className="flex gap-3 mt-6 pt-6 border-t border-gray-800">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === "skip" ? "secondary" : "primary"}
              className="flex-1"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Processing..."
                : mode === "complete"
                  ? "Mark Complete"
                  : mode === "skip"
                    ? "Skip Transaction"
                    : "Record Partial"}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default CompleteTransactionModal;
