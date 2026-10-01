"use client";

import React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect, FormCheckbox, FormDatePicker } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { buildScheduleConfig, type ExpenseRuleFormValues } from "../formHelpers";
import SchedulePreview from "./SchedulePreview";

const StandardDetailsForm: React.FC = () => {
  const { currencySymbol } = useCurrency();
  const { watch, control } = useFormContext<ExpenseRuleFormValues>();
  const expenseType = watch("expenseType");
  const values = useWatch({ control }) as ExpenseRuleFormValues;
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

      {/* A one-time expense has no Schedule step: its single date is previewed here */}
      {isOneTime && (
        <div className="md:col-span-2">
          <SchedulePreview
            frequency="one-time"
            startDate={values.startDate}
            hasEndDate={false}
            weekendAdjustment={values.weekendAdjustment}
            scheduleConfig={buildScheduleConfig(values)}
          />
        </div>
      )}
    </div>
  );
};

export default StandardDetailsForm;
