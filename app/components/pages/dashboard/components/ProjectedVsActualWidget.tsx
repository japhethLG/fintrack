"use client";

import React, { useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface IProps {
  dateRange: { start: string; end: string };
}

const ProjectedVsActualWidget: React.FC<IProps> = ({ dateRange }) => {
  const { transactions } = useFinancial();
  const { formatCurrency } = useCurrency();

  const stats = useMemo(() => {
    const { start, end } = dateRange;

    // Filter transactions in range
    const inRange = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= start && date <= end;
    });

    const income = {
      projected: 0,
      actual: 0,
    };

    const expense = {
      projected: 0,
      actual: 0,
    };

    inRange.forEach((t) => {
      const amount = t.actualAmount ?? t.projectedAmount;
      const isCompleted = t.status === "completed";
      const isSkipped = t.status === "skipped";

      if (isSkipped) return;

      if (t.type === "income") {
        // For projected total, include everything except skipped
        income.projected += t.projectedAmount;
        // For actual, only completed
        if (isCompleted) {
          income.actual += t.actualAmount || t.projectedAmount;
        }
      } else {
        expense.projected += t.projectedAmount;
        if (isCompleted) {
          expense.actual += t.actualAmount || t.projectedAmount;
        }
      }
    });

    return { income, expense };
  }, [transactions, dateRange]);

  const calculateProgress = (actual: number, projected: number) => {
    if (projected === 0) return 0;
    return Math.min(100, (actual / projected) * 100);
  };

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/20 rounded-lg text-primary">
          <Icon name="analytics" size={20} />
        </div>
        <div>
          <h3 className="font-bold text-white">Projected vs Actual</h3>
          <p className="text-xs text-gray-400">For selected period</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Income Section */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Income</span>
            <div className="flex gap-2">
              <span className="text-white font-medium">
                {formatCurrency(stats.income.actual)}
              </span>
              <span className="text-gray-500">
                / {formatCurrency(stats.income.projected)}
              </span>
            </div>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-success transition-all duration-500"
              style={{
                width: `${calculateProgress(stats.income.actual, stats.income.projected)}%`,
              }}
            />
          </div>
          <div className="mt-1 flex justify-end">
            <span className="text-xs text-gray-500">
              {Math.round(calculateProgress(stats.income.actual, stats.income.projected))}% collected
            </span>
          </div>
        </div>

        {/* Expense Section */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-400">Expenses</span>
            <div className="flex gap-2">
              <span className="text-white font-medium">
                {formatCurrency(stats.expense.actual)}
              </span>
              <span className="text-gray-500">
                / {formatCurrency(stats.expense.projected)}
              </span>
            </div>
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full transition-all duration-500",
                stats.expense.actual > stats.expense.projected ? "bg-danger" : "bg-warning"
              )}
              style={{
                width: `${calculateProgress(stats.expense.actual, stats.expense.projected)}%`,
              }}
            />
          </div>
          <div className="mt-1 flex justify-end">
            <span className="text-xs text-gray-500">
              {Math.round(calculateProgress(stats.expense.actual, stats.expense.projected))}% spent
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ProjectedVsActualWidget;

