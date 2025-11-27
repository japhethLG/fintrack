"use client";

import React from "react";
import { Card } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface IProps {
  income: number;
  expenses: number;
  net: number;
  projected: number;
  completed: number;
}

const MonthSummary: React.FC<IProps> = ({ income, expenses, net, projected, completed }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <Card padding="sm">
        <p className="text-xs text-gray-400">Income</p>
        <p className="text-xl font-bold text-success">
          +${income.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </Card>
      <Card padding="sm">
        <p className="text-xs text-gray-400">Expenses</p>
        <p className="text-xl font-bold text-danger">
          -${expenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </Card>
      <Card padding="sm">
        <p className="text-xs text-gray-400">Net Change</p>
        <p className={cn("text-xl font-bold", net >= 0 ? "text-success" : "text-danger")}>
          {net >= 0 ? "+" : ""}${net.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      </Card>
      <Card padding="sm">
        <p className="text-xs text-gray-400">Transactions</p>
        <p className="text-xl font-bold text-white">
          {completed} <span className="text-sm text-gray-400">/ {completed + projected}</span>
        </p>
      </Card>
    </div>
  );
};

export default MonthSummary;
