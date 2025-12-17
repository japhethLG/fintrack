"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import { FormInput, FormSelect, FormCheckbox, FormDatePicker } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { useCurrency } from "@/lib/hooks/useCurrency";
import type { ExpenseRuleFormValues } from "../formHelpers";

const StandardDetailsForm: React.FC = () => {
  const { currencySymbol } = useCurrency();
  const { watch } = useFormContext<ExpenseRuleFormValues>();
  const expenseType = watch("expenseType");
  const isOneTime = expenseType === "one-time";

  const categoryOptions = Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="md:col-span-2">
        <FormInput
          inputName="name"
          label="Expense Name"
          placeholder={
            isOneTime ? "e.g., Doctor visit, Car repair" : "e.g., Netflix, Rent, Electric Bill"
          }
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="amount"
          type="number"
          label="Amount"
          placeholder="0.00"
          prefix={currencySymbol}
          isRequired
        />
      </div>

      <div>
        <FormSelect inputName="category" label="Category" options={categoryOptions} isRequired />
      </div>

      {isOneTime && (
        <div>
          <FormDatePicker inputName="startDate" label="Date" isRequired />
        </div>
      )}

      <div className={isOneTime ? "" : "md:col-span-2"}>
        <FormCheckbox
          inputName="isPriority"
          label="Priority Bill"
          description="Important bills like rent, utilities"
        />
      </div>
    </div>
  );
};

export default StandardDetailsForm;
