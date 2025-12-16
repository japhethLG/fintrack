"use client";

import React from "react";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface PeriodStats {
  income: number;
  expenses: number;
  net: number;
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

  const kpiItems = [
    {
      label: "Current Balance",
      value: formatCurrency(currentBalance, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      color: currentBalance >= 0 ? "text-white" : "text-danger",
      icon: "account_balance_wallet",
      iconColor: "text-primary",
      subtitle: currentBalance < 0 ? "Negative balance!" : undefined,
      subtitleColor: "text-danger",
    },
    {
      label: "Total Income",
      value: `+${formatCurrency(stats.income, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      color: "text-success",
      icon: "trending_up",
      iconColor: "text-success",
      subtitle: `${stats.completedIncomeCount} completed, ${stats.pendingIncomeCount} projected`,
    },
    {
      label: "Total Expenses",
      value: `-${formatCurrency(stats.expenses, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      color: "text-danger",
      icon: "trending_down",
      iconColor: "text-danger",
      subtitle: `${stats.completedExpenseCount} completed, ${stats.pendingExpenseCount} projected`,
    },
    {
      label: "Net Flow",
      value: `${stats.net >= 0 ? "+" : ""}${formatCurrency(stats.net, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      color: stats.net >= 0 ? "text-success" : "text-danger",
      icon: stats.net >= 0 ? "savings" : "money_off",
      iconColor: stats.net >= 0 ? "text-success" : "text-danger",
      subtitle: `${stats.net >= 0 ? "Surplus" : "Deficit"} for period`,
    },
  ];

  return (
    <Card padding="md" className="h-full">
      <h3 className="text-lg font-bold text-white mb-4">Period Summary</h3>
      <div className="grid grid-cols-2 gap-4">
        {kpiItems.map((item) => (
          <div
            key={item.label}
            className="p-3 bg-dark-800 rounded-lg border border-gray-800"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-400 text-xs font-medium">{item.label}</p>
              <Icon name={item.icon} size={16} className={cn("opacity-60", item.iconColor)} />
            </div>
            <h2 className={cn("text-xl font-bold", item.color)}>{item.value}</h2>
            {item.subtitle && (
              <p className={cn("text-xs mt-1", item.subtitleColor || "text-gray-500")}>
                {item.subtitle}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

export default KPICards;

