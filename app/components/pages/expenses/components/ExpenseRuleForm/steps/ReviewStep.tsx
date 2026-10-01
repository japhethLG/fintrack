"use client";

import React, { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Card, Badge } from "@/components/common";
import { FormInput } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import { categoryLabel } from "@/lib/utils/categoryLabel";
import { frequencyLabel, weekendAdjustmentLabel } from "@/lib/utils/ruleLabels";
import { describeSchedule, lastMonthlyPaymentDate } from "@/lib/logic/ruleSchedule";
import { EXPENSE_TYPE_LABELS } from "../../../constants";
import MinimumPaymentWarning from "../components/MinimumPaymentWarning";
import {
  buildScheduleConfig,
  calculateLoanPlan,
  calculateRuleAmount,
  getEffectiveFrequency,
  resolveCreditInputs,
  type ExpenseRuleFormValues,
} from "../formHelpers";

interface IProps {
  error: string | null;
}

const ReviewStep: React.FC<IProps> = ({ error }) => {
  const { formatCurrency } = useCurrency();
  const { formatDate: formatDisplayDate } = useDatePreferences();
  const { control } = useFormContext<ExpenseRuleFormValues>();

  // The same values, resolved the same way, as the document the wizard saves
  const values = useWatch({ control }) as ExpenseRuleFormValues;
  const { expenseType, name, category, isPriority } = values;
  const { loanPrincipal, loanInterestRate, loanTermMonths } = values;
  const { creditMinPaymentMethod } = values;
  const frequency = getEffectiveFrequency(values);

  const loanPlan = useMemo(
    () => (expenseType === "cash_loan" ? calculateLoanPlan(values) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      expenseType,
      values.loanPrincipal,
      values.loanCurrentBalance,
      values.loanInterestRate,
      values.loanTermMonths,
      values.loanCalculationType,
      values.loanStartDate,
      values.loanPaymentsMade,
    ]
  );
  const calculatedLoanPayment = loanPlan?.payment ?? null;
  const isOneTime = frequency === "one-time";
  const schedule = describeSchedule(
    frequency,
    buildScheduleConfig(values),
    values.startDate,
    frequencyLabel(frequency)
  );
  // Dates print in the Date Format preference (MANUAL-L5)
  const showDate = (date: string | Date) => formatDisplayDate(date);
  // An installment plan ends with its last payment, placed as the engine places it
  const installmentCount = Number(values.installmentCount);
  const installmentTotal = Number(values.installmentTotal);
  const lastInstallment =
    expenseType === "installment"
      ? lastMonthlyPaymentDate(
          values.startDate,
          values.dayOfMonth,
          values.installmentCount,
          values.weekendAdjustment
        )
      : null;
  const card = resolveCreditInputs(values);
  const displayAmount = calculateRuleAmount(values);

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-white">Review & Confirm</h3>

      <Card padding="md">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Type</p>
            <p className="text-white font-medium">{EXPENSE_TYPE_LABELS[expenseType] ?? expenseType}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Name</p>
            <p className="text-white font-medium">{name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">
              {expenseType === "cash_loan"
                ? "Monthly Payment"
                : expenseType === "credit_card"
                  ? "Est. Min Payment"
                  : "Amount"}
            </p>
            <p className="text-danger font-bold text-xl">
              {formatCurrency(displayAmount, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Frequency</p>
            <p className="text-white font-medium">{frequencyLabel(frequency)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Category</p>
            <p className="text-white font-medium">
              {EXPENSE_CATEGORY_LABELS[category] ?? categoryLabel(category)}
            </p>
          </div>
          {!isOneTime && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400">Schedule</p>
              <p className="text-white font-medium">{schedule}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">
              {isOneTime ? "Date" : expenseType === "credit_card" ? "Tracking From" : "First Payment"}
            </p>
            <p className="text-white font-medium">{showDate(values.startDate)}</p>
          </div>
          {!isOneTime && (
            <div>
              <p className="text-xs text-gray-400">Weekend Adjustment</p>
              <p className="text-white font-medium">
                {weekendAdjustmentLabel(values.weekendAdjustment)}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400">Priority</p>
            <Badge variant={isPriority ? "warning" : "default"}>
              {isPriority ? "High Priority" : "Normal"}
            </Badge>
          </div>
        </div>

        {expenseType === "cash_loan" && calculatedLoanPayment && (
          <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Principal</p>
              <p className="text-white font-medium">{formatCurrency(parseFloat(loanPrincipal))}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Interest Rate</p>
              <p className="text-white font-medium">{loanInterestRate}% APR</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Term</p>
              <p className="text-white font-medium">{loanTermMonths} months</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Total Interest</p>
              <p className="text-danger font-medium">
                {formatCurrency(loanPlan?.totalInterest ?? 0, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </p>
            </div>
          </div>
        )}

        {expenseType === "installment" && (
          <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Total Amount</p>
              <p className="text-white font-medium">
                {formatCurrency(Number.isFinite(installmentTotal) ? installmentTotal : 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Number of Payments</p>
              <p className="text-white font-medium">
                {Number.isFinite(installmentCount) ? installmentCount : 0}
              </p>
            </div>
            {lastInstallment && (
              <div>
                <p className="text-xs text-gray-400">Last Payment</p>
                <p className="text-white font-medium">
                  {showDate(lastInstallment)}
                </p>
              </div>
            )}
          </div>
        )}

        {expenseType === "credit_card" && (
          <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Current Balance</p>
              <p className="text-white font-medium">{formatCurrency(card.currentBalance)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">APR</p>
              <p className="text-white font-medium">{card.apr}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Min Payment Rule</p>
              <p className="text-white font-medium">
                {card.minimumPaymentPercent}%
                {creditMinPaymentMethod === "percent_plus_interest" ? " + Interest" : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Due Date</p>
              <p className="text-white font-medium">Day {card.dueDate}</p>
            </div>
          </div>
        )}
      </Card>

      <MinimumPaymentWarning />

      <FormInput inputName="notes" label="Notes (Optional)" placeholder="Any additional notes..." />

      {error && (
        <div className="p-4 bg-danger/20 border border-danger/30 rounded-lg text-danger">
          {error}
        </div>
      )}
    </div>
  );
};

export default ReviewStep;
