"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import StandardDetailsForm from "../components/StandardDetailsForm";
import LoanDetailsForm from "../components/LoanDetailsForm";
import CreditCardDetailsForm from "../components/CreditCardDetailsForm";
import InstallmentDetailsForm from "../components/InstallmentDetailsForm";
import type { ExpenseRuleFormValues } from "../formHelpers";

const DetailsStep: React.FC = () => {
  const { watch } = useFormContext<ExpenseRuleFormValues>();
  const expenseType = watch("expenseType");

  const getTitle = () => {
    switch (expenseType) {
      case "cash_loan":
        return "Loan Details";
      case "credit_card":
        return "Credit Card Details";
      case "installment":
        return "Installment Details";
      default:
        return "Expense Details";
    }
  };

  return (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-white">{getTitle()}</h3>

      {(expenseType === "fixed" || expenseType === "variable" || expenseType === "one-time") && (
        <StandardDetailsForm />
      )}

      {expenseType === "cash_loan" && <LoanDetailsForm />}

      {expenseType === "credit_card" && <CreditCardDetailsForm />}

      {expenseType === "installment" && <InstallmentDetailsForm />}
    </div>
  );
};

export default DetailsStep;
