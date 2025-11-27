"use client";

import React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { PAYMENT_STRATEGIES, MINIMUM_PAYMENT_METHODS } from "../constants";
import type { ExpenseRuleFormValues } from "../formHelpers";

const CreditCardDetailsForm: React.FC = () => {
  const { control } = useFormContext<ExpenseRuleFormValues>();
  const creditPaymentStrategy = useWatch({ control, name: "creditPaymentStrategy" });

  const categoryOptions = Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="md:col-span-2">
        <FormInput
          inputName="name"
          label="Credit Card Name"
          placeholder="e.g., Chase Sapphire, Capital One"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="creditLimit"
          type="number"
          label="Credit Limit"
          tooltip="The maximum amount you can borrow on this card"
          placeholder="0.00"
          prefix="$"
        />
      </div>

      <div>
        <FormInput
          inputName="creditBalance"
          type="number"
          label="Current Balance"
          tooltip="The amount currently owed on this card"
          placeholder="0.00"
          prefix="$"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="creditApr"
          type="number"
          label="APR"
          tooltip="Annual Percentage Rate - the yearly interest rate charged on balances"
          placeholder="e.g., 24.99"
          suffix="%"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="creditMinPaymentPercent"
          type="number"
          label="Minimum Payment %"
          tooltip="Percentage of balance required as minimum payment (usually 1-3%)"
          placeholder="2"
          suffix="%"
        />
      </div>

      <div>
        <FormInput
          inputName="creditMinPaymentFloor"
          type="number"
          label="Min Payment Floor"
          tooltip="Minimum payment amount regardless of balance percentage"
          placeholder="25"
          prefix="$"
        />
      </div>

      <div>
        <FormSelect
          inputName="creditMinPaymentMethod"
          label="Min Payment Calculation"
          options={MINIMUM_PAYMENT_METHODS}
        />
      </div>

      <div>
        <FormInput
          inputName="creditStatementDate"
          type="number"
          label="Statement Date"
          tooltip="Day of month when your billing statement is generated"
          placeholder="Day of month"
          min={1}
          max={31}
        />
      </div>

      <div>
        <FormInput
          inputName="creditDueDate"
          type="number"
          label="Due Date"
          tooltip="Day of month when payment is due to avoid late fees"
          placeholder="Day of month"
          min={1}
          max={31}
        />
      </div>

      <div>
        <FormSelect
          inputName="creditPaymentStrategy"
          label="Payment Strategy"
          options={PAYMENT_STRATEGIES}
        />
      </div>

      {creditPaymentStrategy === "fixed" && (
        <div>
          <FormInput
            inputName="creditFixedPayment"
            type="number"
            label="Fixed Payment Amount"
            placeholder="0.00"
            prefix="$"
          />
        </div>
      )}

      <div>
        <FormSelect inputName="category" label="Category" options={categoryOptions} isRequired />
      </div>
    </div>
  );
};

export default CreditCardDetailsForm;
