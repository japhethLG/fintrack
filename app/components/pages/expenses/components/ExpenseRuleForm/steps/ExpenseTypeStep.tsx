"use client";

import React from "react";
import { useFormContext } from "react-hook-form";
import { Card } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { EXPENSE_TYPES } from "../constants";
import type { ExpenseRuleFormValues } from "../formHelpers";
import type { ExpenseType } from "@/lib/types";

const ExpenseTypeStep: React.FC = () => {
  const { watch, setValue } = useFormContext<ExpenseRuleFormValues>();
  const expenseType = watch("expenseType");

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-white">Select Expense Type</h3>
      <p className="text-gray-400">What type of expense is this?</p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {EXPENSE_TYPES.map((type) => (
          <Card
            key={type.value}
            className={cn(
              "cursor-pointer transition-all hover:border-primary",
              expenseType === type.value && "border-primary bg-primary/10"
            )}
            padding="sm"
            onClick={() => setValue("expenseType", type.value as ExpenseType)}
          >
            <h4 className="font-bold text-white">{type.label}</h4>
            <p className="text-xs text-gray-400 mt-1">{type.description}</p>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ExpenseTypeStep;
