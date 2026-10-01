"use client";

import React, { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormInput, FormSelect, FormDatePicker } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import { LOAN_CALCULATION_TYPES } from "../constants";
import { calculateLoanPlan, type ExpenseRuleFormValues } from "../formHelpers";

const LoanDetailsForm: React.FC = () => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const { formatDate: formatDisplayDate } = useDatePreferences();
  const { control } = useFormContext<ExpenseRuleFormValues>();

  const loanPrincipal = useWatch({ control, name: "loanPrincipal" });
  const loanCurrentBalance = useWatch({ control, name: "loanCurrentBalance" });
  const loanInterestRate = useWatch({ control, name: "loanInterestRate" });
  const loanTermMonths = useWatch({ control, name: "loanTermMonths" });
  const startDate = useWatch({ control, name: "startDate" });
  const dayOfMonth = useWatch({ control, name: "dayOfMonth" });
  const loanStoredPayment = useWatch({ control, name: "loanStoredPayment" });
  const loanStoredTerms = useWatch({ control, name: "loanStoredTerms" });
  const loanCalculationType = useWatch({ control, name: "loanCalculationType" });
  const loanPaymentsMade = useWatch({ control, name: "loanPaymentsMade" });

  const categoryOptions = Object.entries(EXPENSE_CATEGORY_LABELS).map(([value, label]) => ({
    value,
    label,
  }));

  // ONE plan drives the headline payment, the preview and the total interest, so they
  // always describe the same balance and term (the current balance when given).
  const plan = useMemo(() => {
    if (!loanPrincipal || !loanInterestRate || !loanTermMonths) return null;
    return calculateLoanPlan({
      loanPrincipal,
      loanCurrentBalance,
      loanInterestRate,
      loanTermMonths,
      loanCalculationType,
      startDate,
      dayOfMonth,
      loanStoredPayment,
      loanStoredTerms,
      loanPaymentsMade,
    });
  }, [
    loanPrincipal,
    loanCurrentBalance,
    loanInterestRate,
    loanTermMonths,
    loanCalculationType,
    startDate,
    dayOfMonth,
    loanStoredPayment,
    loanStoredTerms,
    loanPaymentsMade,
  ]);
  const calculatedPayment = plan?.payment ?? null;
  const amortizationPreview = useMemo(() => (plan ? plan.schedule.slice(0, 6) : []), [plan]);

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
          prefix={currencySymbol}
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
          prefix={currencySymbol}
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
        <p className="text-xs text-gray-400 mt-1">
          {LOAN_CALCULATION_TYPES.find((t) => t.value === loanCalculationType)?.description}
        </p>
      </div>

      <div>
        {/* THE loan date: the schedule (this table, the next step, the calendar) starts here */}
        <FormDatePicker inputName="startDate" label="First Payment Date" />
        <p className="text-xs text-gray-400 mt-1">
          The day the first payment is due. Every payment below, and the schedule on the next step,
          follows from it.
        </p>
      </div>

      <div>
        <FormSelect inputName="category" label="Category" options={categoryOptions} isRequired />
      </div>

      {/* Calculated Payment */}
      {calculatedPayment && (
        <div className="md:col-span-2 bg-gray-800/50 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-1">Calculated Monthly Payment</p>
          <p className="text-3xl font-bold text-danger">
            {formatCurrency(calculatedPayment, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          {loanCalculationType === "reducing_balance" && (
            <p className="text-xs text-gray-400 mt-1">
              First month&apos;s payment. It falls every month as the balance is repaid.
            </p>
          )}
          <p className="text-sm text-gray-400 mt-2">
            Total Interest:{" "}
            {formatCurrency(plan?.totalInterest ?? 0, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
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
                    <td className="py-2 text-gray-300">{formatDisplayDate(row.date)}</td>
                    <td className="py-2 text-right text-white">
                      {formatCurrency(row.principal, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 text-right text-danger">
                      {formatCurrency(row.interest, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-2 text-right text-gray-300">
                      {formatCurrency(row.remainingBalance, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
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
