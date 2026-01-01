"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import { Transaction } from "@/lib/types";
import { Button, Card } from "@/components/common";
import { Form, FormInput, FormSelect, FormTextArea } from "@/components/formElements";
import { useCurrency } from "@/lib/hooks/useCurrency";
import {
  formSchema,
  getDefaultValues,
  transformToTransactionData,
  getSmartStatus,
  type ManualTransactionFormValues,
} from "./formHelpers";
import {
  TRANSACTION_TYPE_OPTIONS,
  STATUS_OPTIONS,
  INCOME_CATEGORY_OPTIONS,
  EXPENSE_CATEGORY_OPTIONS,
} from "./constants";

interface IProps {
  initialData?: Transaction;
  onSubmit: (data: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  isEditing?: boolean;
}

const ManualTransactionForm: React.FC<IProps> = ({
  initialData,
  onSubmit,
  onCancel,
  onDelete,
  isEditing = false,
}) => {
  const { currencySymbol } = useCurrency();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useForm<ManualTransactionFormValues>({
    defaultValues: getDefaultValues(initialData),
    resolver: yupResolver(formSchema) as never,
    mode: "onChange",
  });

  const { watch, setValue } = methods;
  const transactionType = watch("type");
  const selectedDate = watch("scheduledDate");

  // Get category options based on transaction type
  const categoryOptions = useMemo(() => {
    return transactionType === "income" ? INCOME_CATEGORY_OPTIONS : EXPENSE_CATEGORY_OPTIONS;
  }, [transactionType]);

  // Auto-adjust status when date changes (only if not editing)
  useEffect(() => {
    if (!isEditing && selectedDate) {
      const smartStatus = getSmartStatus(selectedDate);
      setValue("status", smartStatus);
    }
  }, [selectedDate, isEditing, setValue]);

  // Reset category when type changes
  useEffect(() => {
    if (!isEditing) {
      setValue("category", "other");
    }
  }, [transactionType, isEditing, setValue]);

  const handleSubmit = async (values: ManualTransactionFormValues) => {
    setError(null);
    setIsSubmitting(true);

    try {
      const transactionData = transformToTransactionData(values);
      await onSubmit(transactionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save transaction");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form methods={methods} onSubmit={handleSubmit}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-white mb-2">
            {isEditing ? "Edit Transaction" : "Add Manual Transaction"}
          </h2>
          <p className="text-sm text-gray-400">
            {isEditing
              ? "Update transaction details"
              : "Create a one-time transaction not tied to recurring rules"}
          </p>
        </div>

        {/* Form Fields */}
        <div className="space-y-4">
          {/* Name */}
          <FormInput
            inputName="name"
            label="Name"
            placeholder="e.g., Grocery Shopping, Freelance Payment"
            isRequired
          />

          {/* Type & Category Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormSelect
              inputName="type"
              label="Type"
              options={TRANSACTION_TYPE_OPTIONS}
              isRequired
            />

            <FormSelect
              inputName="category"
              label="Category"
              options={categoryOptions}
              isRequired
            />
          </div>

          {/* Amount & Date Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              inputName="amount"
              type="number"
              label="Amount"
              prefix={currencySymbol}
              placeholder="0.00"
              isRequired
            />

            <FormInput inputName="scheduledDate" type="date" label="Date" isRequired />
          </div>

          {/* Status */}
          <FormSelect inputName="status" label="Status" options={STATUS_OPTIONS} isRequired />

          {/* Notes */}
          <FormTextArea inputName="notes" label="Notes" placeholder="Optional notes..." rows={3} />
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-danger/20 border border-danger/30 rounded-lg text-danger text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between pt-6 border-t border-gray-800">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel} type="button">
              Cancel
            </Button>
            {onDelete && (
              <Button
                variant="danger"
                onClick={async () => {
                  setIsSubmitting(true);
                  try {
                    await onDelete();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to delete transaction");
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
                type="button"
                disabled={isSubmitting}
              >
                Delete
              </Button>
            )}
          </div>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : isEditing ? "Save Changes" : "Create Transaction"}
          </Button>
        </div>
      </div>
    </Form>
  );
};

export default ManualTransactionForm;
