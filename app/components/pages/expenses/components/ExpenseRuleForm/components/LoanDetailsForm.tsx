"use client";

import React, { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { calculateAmortizationSchedule } from "@/lib/logic/amortization";
import { LOAN_CALCULATION_TYPES } from "../constants";
import { calculateLoanPayment, type ExpenseRuleFormValues } from "../formHelpers";

const LoanDetailsForm: React.FC = () => {
  const { control } = useFormContext<ExpenseRuleFormValues>();

  const loanPrincipal = useWatch({ control, name: "loanPrincipal" });
  const loanCurrentBalance = useWatch({ control, name: "loanCurrentBalance" });
  const loanInterestRate = useWatch({ control, name: "loanInterestRate" });
  const loanTermMonths = useWatch({ control, name: "loanTermMonths" });
  const loanStartDate = useWatch({ control, name: "loanStartDate" });

  const categoryOptions = Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  const calculatedPayment = useMemo(() => {
    if (!loanPrincipal || !loanInterestRate || !loanTermMonths) return null;
    return calculateLoanPayment(
      parseFloat(loanPrincipal),
      parseFloat(loanInterestRate),
      parseInt(loanTermMonths)
    );
  }, [loanPrincipal, loanInterestRate, loanTermMonths]);

  const amortizationPreview = useMemo(() => {
    if (!calculatedPayment || !loanPrincipal || !loanInterestRate) return [];

    const schedule = calculateAmortizationSchedule({
      principal: parseFloat(loanCurrentBalance || loanPrincipal),
      annualRate: parseFloat(loanInterestRate),
      termMonths: parseInt(loanTermMonths),
      startDate: new Date(loanStartDate),
    });

    return schedule.slice(0, 6);
  }, [
    calculatedPayment,
    loanPrincipal,
    loanCurrentBalance,
    loanInterestRate,
    loanTermMonths,
    loanStartDate,
  ]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="md:col-span-2">
        <FormInput
          inputName="name"
          label="Loan Name"
          placeholder="e.g., Car Loan, Personal Loan"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="loanPrincipal"
          type="number"
          label="Original Principal"
          tooltip="The total amount borrowed (original loan amount)"
          placeholder="0.00"
          prefix="$"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="loanCurrentBalance"
          type="number"
          label="Current Balance"
          tooltip="How much you still owe. Leave empty if this is a new loan."
          placeholder="Same as principal if new"
          prefix="$"
        />
      </div>

      <div>
        <FormInput
          inputName="loanInterestRate"
          type="number"
          label="Annual Interest Rate"
          tooltip="The yearly interest rate (APR) charged on the loan"
          placeholder="e.g., 5.5"
          suffix="%"
          isRequired
        />
      </div>

      <div>
        <FormInput
          inputName="loanTermMonths"
          type="number"
          label="Term (Months)"
          tooltip="Total number of months to pay off the loan"
          placeholder="e.g., 48"
          isRequired
        />
      </div>

      <div>
        <FormSelect
          inputName="loanCalculationType"
          label="Calculation Type"
          options={LOAN_CALCULATION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        />
      </div>

      <div>
        <FormInput
          inputName="loanStartDate"
          type="date"
          label="Loan Start Date"
          tooltip="When the loan was issued or when payments began"
        />
      </div>

      <div>
        <FormSelect inputName="category" label="Category" options={categoryOptions} isRequired />
      </div>

      {/* Calculated Payment */}
      {calculatedPayment && (
        <div className="md:col-span-2 bg-gray-800/50 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-1">Calculated Monthly Payment</p>
          <p className="text-3xl font-bold text-danger">${calculatedPayment.toFixed(2)}</p>
          <p className="text-sm text-gray-400 mt-2">
            Total Interest: $
            {(calculatedPayment * parseInt(loanTermMonths) - parseFloat(loanPrincipal)).toFixed(2)}
          </p>
        </div>
      )}

      {/* Amortization Preview */}
      {amortizationPreview.length > 0 && (
        <div className="md:col-span-2">
          <p className="text-sm font-medium text-gray-400 mb-3">Payment Schedule Preview</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="pb-2">Payment</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2 text-right">Principal</th>
                  <th className="pb-2 text-right">Interest</th>
                  <th className="pb-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {amortizationPreview.map((row, i) => (
                  <tr key={i} className="border-t border-gray-800">
                    <td className="py-2 text-white">#{i + 1}</td>
                    <td className="py-2 text-gray-300">{row.date.toLocaleDateString()}</td>
                    <td className="py-2 text-right text-white">${row.principal.toFixed(2)}</td>
                    <td className="py-2 text-right text-danger">${row.interest.toFixed(2)}</td>
                    <td className="py-2 text-right text-gray-300">
                      ${row.remainingBalance.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoanDetailsForm;
