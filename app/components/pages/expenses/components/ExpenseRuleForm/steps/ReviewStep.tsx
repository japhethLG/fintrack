"use client";

import React, { useMemo } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Card, Badge } from "@/components/common";
import { FormInput } from "@/components/formElements";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/constants";
import {
  calculateLoanPayment,
  calculateInstallmentAmount,
  calculateCreditCardPayment,
  type ExpenseRuleFormValues,
} from "../formHelpers";

interface IProps {
  error: string | null;
}

const ReviewStep: React.FC<IProps> = ({ error }) => {
  const { control } = useFormContext<ExpenseRuleFormValues>();

  const expenseType = useWatch({ control, name: "expenseType" });
  const name = useWatch({ control, name: "name" });
  const amount = useWatch({ control, name: "amount" });
  const category = useWatch({ control, name: "category" });
  const frequency = useWatch({ control, name: "frequency" });
  const isPriority = useWatch({ control, name: "isPriority" });

  // Loan
  const loanPrincipal = useWatch({ control, name: "loanPrincipal" });
  const loanInterestRate = useWatch({ control, name: "loanInterestRate" });
  const loanTermMonths = useWatch({ control, name: "loanTermMonths" });

  // Credit
  const creditBalance = useWatch({ control, name: "creditBalance" });
  const creditApr = useWatch({ control, name: "creditApr" });
  const creditMinPaymentPercent = useWatch({ control, name: "creditMinPaymentPercent" });
  const creditMinPaymentFloor = useWatch({ control, name: "creditMinPaymentFloor" });
  const creditMinPaymentMethod = useWatch({ control, name: "creditMinPaymentMethod" });
  const creditDueDate = useWatch({ control, name: "creditDueDate" });

  // Installment
  const installmentTotal = useWatch({ control, name: "installmentTotal" });
  const installmentCount = useWatch({ control, name: "installmentCount" });
  const installmentHasInterest = useWatch({ control, name: "installmentHasInterest" });
  const installmentInterestRate = useWatch({ control, name: "installmentInterestRate" });

  const calculatedLoanPayment = useMemo(() => {
    if (expenseType !== "cash_loan" || !loanPrincipal || !loanInterestRate || !loanTermMonths) {
      return null;
    }
    return calculateLoanPayment(
      parseFloat(loanPrincipal),
      parseFloat(loanInterestRate),
      parseInt(loanTermMonths)
    );
  }, [expenseType, loanPrincipal, loanInterestRate, loanTermMonths]);

  const calculatedCreditPayment = useMemo(() => {
    if (expenseType !== "credit_card" || !creditBalance || !creditApr || !creditMinPaymentPercent) {
      return null;
    }
    return calculateCreditCardPayment(
      parseFloat(creditBalance),
      parseFloat(creditApr),
      parseFloat(creditMinPaymentPercent),
      parseFloat(creditMinPaymentFloor) || 0,
      creditMinPaymentMethod
    );
  }, [
    expenseType,
    creditBalance,
    creditApr,
    creditMinPaymentPercent,
    creditMinPaymentFloor,
    creditMinPaymentMethod,
  ]);

  const calculatedInstallmentAmount = useMemo(() => {
    if (expenseType !== "installment" || !installmentTotal || !installmentCount) {
      return null;
    }
    return calculateInstallmentAmount(
      parseFloat(installmentTotal),
      parseInt(installmentCount),
      installmentHasInterest,
      installmentInterestRate ? parseFloat(installmentInterestRate) : undefined
    );
  }, [
    expenseType,
    installmentTotal,
    installmentCount,
    installmentHasInterest,
    installmentInterestRate,
  ]);

  const displayAmount = useMemo(() => {
    if (calculatedLoanPayment) return calculatedLoanPayment;
    if (calculatedCreditPayment) return calculatedCreditPayment;
    if (calculatedInstallmentAmount) return calculatedInstallmentAmount;
    return parseFloat(amount || "0");
  }, [calculatedLoanPayment, calculatedCreditPayment, calculatedInstallmentAmount, amount]);

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-white">Review & Confirm</h3>

      <Card padding="md">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Type</p>
            <p className="text-white font-medium capitalize">{expenseType.replace("_", " ")}</p>
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
              $
              {displayAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Frequency</p>
            <p className="text-white font-medium capitalize">{frequency.replace("-", " ")}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Category</p>
            <p className="text-white font-medium">{EXPENSE_CATEGORY_LABELS[category]}</p>
          </div>
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
              <p className="text-white font-medium">
                ${parseFloat(loanPrincipal).toLocaleString()}
              </p>
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
                $
                {(
                  calculatedLoanPayment * parseInt(loanTermMonths) -
                  parseFloat(loanPrincipal)
                ).toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {expenseType === "credit_card" && (
          <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Current Balance</p>
              <p className="text-white font-medium">
                ${parseFloat(creditBalance).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">APR</p>
              <p className="text-white font-medium">{creditApr}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Min Payment Rule</p>
              <p className="text-white font-medium">
                {creditMinPaymentPercent}%
                {creditMinPaymentMethod === "percent_plus_interest" ? " + Interest" : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Due Date</p>
              <p className="text-white font-medium">Day {creditDueDate}</p>
            </div>
          </div>
        )}
      </Card>

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
