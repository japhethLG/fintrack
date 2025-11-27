"use client";

import React, { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect, FormCheckbox } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { calculateInstallmentAmount, type ExpenseRuleFormValues } from "../formHelpers";

const InstallmentDetailsForm: React.FC = () => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const { control } = useFormContext<ExpenseRuleFormValues>();

  const installmentTotal = useWatch({ control, name: "installmentTotal" });
  const installmentCount = useWatch({ control, name: "installmentCount" });
  const installmentHasInterest = useWatch({ control, name: "installmentHasInterest" });
  const installmentInterestRate = useWatch({ control, name: "installmentInterestRate" });

  const categoryOptions = Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const calculatedAmount = useMemo(() => {
    if (!installmentTotal || !installmentCount) return null;
    return calculateInstallmentAmount(
      parseFloat(installmentTotal),
      parseInt(installmentCount),
      installmentHasInterest,
      installmentInterestRate ? parseFloat(installmentInterestRate) : undefined
    );
  }, [installmentTotal, installmentCount, installmentHasInterest, installmentInterestRate]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="md:col-span-2">
        <FormInput
          inputName="name"
          label="Item Name"
          placeholder="e.g., MacBook Pro, iPhone"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="installmentTotal"
          type="number"
          label="Total Amount"
          tooltip="The full purchase price of the item"
          placeholder="0.00"
          prefix={currencySymbol}
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="installmentCount"
          type="number"
          label="Number of Installments"
          tooltip="How many equal payments to divide the total into"
          placeholder="12"
          isRequired
        />
      </div>

      <div className="md:col-span-2">
        <FormCheckbox inputName="installmentHasInterest" label="Has Interest" />
      </div>

      {installmentHasInterest && (
        <div>
          <FormInput
            inputName="installmentInterestRate"
            type="number"
            label="Interest Rate"
            placeholder="e.g., 12"
            suffix="%"
          />
        </div>
      )}

      <div>
        <FormSelect inputName="category" label="Category" options={categoryOptions} isRequired />
      </div>

      {/* Calculated Installment */}
      {calculatedAmount && (
        <div className="md:col-span-2 bg-gray-800/50 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-1">Monthly Installment</p>
          <p className="text-3xl font-bold text-danger">
            {formatCurrency(calculatedAmount, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p className="text-sm text-gray-400 mt-2">{installmentCount} payments</p>
        </div>
      )}
    </div>
  );
};

export default InstallmentDetailsForm;
