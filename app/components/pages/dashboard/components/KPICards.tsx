"use client";

import React from "react";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface PeriodStats {
  income: number;
  expenses: number;
  completedIncomeCount: number;
  pendingIncomeCount: number;
  skippedIncomeCount: number;
  completedExpenseCount: number;
  pendingExpenseCount: number;
  skippedExpenseCount: number;
}

interface IProps {
  currentBalance: number;
  stats: PeriodStats;
}

const KPICards: React.FC<IProps> = ({ currentBalance, stats }) => {
  const { formatCurrency } = useCurrency();

  return (
    <>
      <Card padding="md" className="relative overflow-hidden">
        <div className="relative z-10">
          <p className="text-gray-400 text-sm font-medium mb-2">Current Balance</p>
          <h2
            className={cn("text-3xl font-bold", currentBalance >= 0 ? "text-white" : "text-danger")}
          >
            {formatCurrency(currentBalance, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h2>
          {currentBalance < 0 && <p className="text-danger text-xs mt-1">Negative balance!</p>}
        </div>
        <div className="absolute -right-4 -bottom-4 opacity-10">
          <Icon name="account_balance_wallet" size={100} className="text-white" />
        </div>
      </Card>

      <Card padding="md">
        <p className="text-gray-400 text-sm font-medium mb-2">Total Income</p>
        <h2 className="text-3xl font-bold text-success">
          +{formatCurrency(stats.income, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {stats.completedIncomeCount} completed, {stats.pendingIncomeCount} projected
          {stats.skippedIncomeCount > 0 && `, ${stats.skippedIncomeCount} skipped`}
        </p>
      </Card>

      <Card padding="md">
        <p className="text-gray-400 text-sm font-medium mb-2">Total Expenses</p>
        <h2 className="text-3xl font-bold text-danger">
          -{formatCurrency(stats.expenses, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {stats.completedExpenseCount} completed, {stats.pendingExpenseCount} projected
          {stats.skippedExpenseCount > 0 && `, ${stats.skippedExpenseCount} skipped`}
        </p>
      </Card>
    </>
  );
};

export default KPICards;
