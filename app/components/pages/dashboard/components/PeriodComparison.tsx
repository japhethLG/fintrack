"use client";

import React, { useMemo } from "react";
import { Card, Icon } from "@/components/common";
import { Transaction } from "@/lib/types";
import { getPeriodStats } from "@/lib/logic/healthScore";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/dateUtils";

interface IProps {
  transactions: Transaction[];
  dateRange: {
    start: string;
    end: string;
  };
}

const PeriodComparison: React.FC<IProps> = ({ transactions, dateRange }) => {
  // Calculate previous period stats
  const comparisonData = useMemo(() => {
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const duration = end.getTime() - start.getTime();

    // Previous period is same duration immediately before start date
    const prevEnd = new Date(start.getTime() - 24 * 60 * 60 * 1000); // 1 day before start
    const prevStart = new Date(prevEnd.getTime() - duration);

    const prevStartStr = formatDate(prevStart);
    const prevEndStr = formatDate(prevEnd);

    const currentStats = getPeriodStats(transactions, dateRange.start, dateRange.end);
    const prevStats = getPeriodStats(transactions, prevStartStr, prevEndStr);

    // Calculate percentage changes
    const calculateChange = (current: number, prev: number) => {
      if (prev === 0) return current > 0 ? 100 : 0;
      return ((current - prev) / prev) * 100;
    };

    return {
      current: currentStats,
      prev: prevStats,
      changes: {
        income: calculateChange(currentStats.income, prevStats.income),
        expenses: calculateChange(currentStats.expenses, prevStats.expenses),
        net: calculateChange(currentStats.net, prevStats.net),
      },
      prevPeriodLabel: `${prevStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${prevEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    };
  }, [transactions, dateRange]);

  const renderChange = (percent: number, type: "income" | "expense" | "net") => {
    if (percent === 0) return <span className="text-gray-500 text-xs">0%</span>;

    const isPositive = percent > 0;

    // For expenses, increase is bad (red), decrease is good (green)
    // For income/net, increase is good (green), decrease is bad (red)
    let isGood: boolean;
    if (type === "expense") {
      isGood = !isPositive;
    } else {
      isGood = isPositive;
    }

    return (
      <span
        className={cn(
          "text-xs flex items-center gap-0.5",
          isGood ? "text-success" : "text-danger"
        )}
      >
        <Icon
          name={isPositive ? "arrow_upward" : "arrow_downward"}
          size={12}
          className={isGood ? "text-success" : "text-danger"}
        />
        {Math.abs(percent).toFixed(1)}%
      </span>
    );
  };

  return (
    <Card className="lg:col-span-1" padding="md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Period Comparison</h3>
        <span className="text-xs text-gray-400">vs {comparisonData.prevPeriodLabel}</span>
      </div>

      <div className="space-y-4">
        {/* Income */}
        <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Total Income</span>
            {renderChange(comparisonData.changes.income, "income")}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-success">
              +${comparisonData.current.income.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              was ${comparisonData.prev.income.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Expenses */}
        <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Total Expenses</span>
            {renderChange(comparisonData.changes.expenses, "expense")}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-danger">
              -${comparisonData.current.expenses.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              was ${comparisonData.prev.expenses.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Net */}
        <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Net Flow</span>
            {renderChange(comparisonData.changes.net, "net")}
          </div>
          <div className="flex items-baseline justify-between">
            <span
              className={cn(
                "text-xl font-bold",
                comparisonData.current.net >= 0 ? "text-success" : "text-danger"
              )}
            >
              {comparisonData.current.net >= 0 ? "+" : ""}
              ${comparisonData.current.net.toLocaleString()}
            </span>
            <span className="text-xs text-gray-500">
              was ${comparisonData.prev.net.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PeriodComparison;

