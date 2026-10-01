"use client";

import React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Icon } from "@/components/common";
import { isMinimumPaymentTrap, type ExpenseRuleFormValues } from "../formHelpers";

/**
 * The minimum-payment trap warning, in the wizard: the card's payment barely covers (or never beats) its
 * monthly interest, so the balance hardly shrinks. It is the SAME detection the card's detail view uses
 * (`isMinimumPaymentTrap`), shown while the card is being set up instead of after it is saved.
 */
const MinimumPaymentWarning: React.FC = () => {
  const { control } = useFormContext<ExpenseRuleFormValues>();
  const values = useWatch({ control }) as ExpenseRuleFormValues;
  if (values.expenseType !== "credit_card" || !isMinimumPaymentTrap(values)) return null;

  return (
    <div
      role="status"
      className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-warning flex gap-3"
    >
      <Icon name="warning" size={20} />
      <div className="text-sm">
        <p className="font-medium">Minimum-payment trap</p>
        <p className="text-gray-300">
          Your payment barely covers interest. Consider increasing your payment, or the balance will
          take very long to pay off (or never).
        </p>
      </div>
    </div>
  );
};

export default MinimumPaymentWarning;
