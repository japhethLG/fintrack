"use client";

import React, { useMemo } from "react";
import { Card, Icon } from "@/components/common";
import { Transaction } from "@/lib/types";
import { getPeriodStats, percentChange } from "@/lib/logic/healthScore";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import { dateFromDayNumber, dayNumberOfDate, formatDate, parseDate } from "@/lib/utils/dateUtils";
import { amountTone } from "@/lib/utils/amountTone";

interface IProps {
  transactions: Transaction[];
  dateRange: {
    start: string;
    end: string;
  };
}

const PeriodComparison: React.FC<IProps> = ({ transactions, dateRange }) => {
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();
  const { formatDayMonth } = useDatePreferences();

  // Calculate previous period stats
  const comparisonData = useMemo(() => {
    // Whole calendar days on local day numbers: no UTC parsing (a day early/late by zone) and no
    // millisecond arithmetic (skewed by DST).
    const startDay = dayNumberOfDate(parseDate(dateRange.start));
    const endDay = dayNumberOfDate(parseDate(dateRange.end));
    const durationDays = endDay - startDay;

    // Previous period is same duration immediately before start date
    const prevEnd = dateFromDayNumber(startDay - 1); // 1 day before start
    const prevStart = dateFromDayNumber(startDay - 1 - durationDays);

    const prevStartStr = formatDate(prevStart);
    const prevEndStr = formatDate(prevEnd);

    const currentStats = getPeriodStats(transactions, dateRange.start, dateRange.end);
    const prevStats = getPeriodStats(transactions, prevStartStr, prevEndStr);

    // Percent changes are measured against |previous| (a worsening negative net flow is a drop, not
    // a rise); with no baseline (previous 0) the change is "new" (null), not an invented number.
    const calculateChange = (current: number, prev: number) => percentChange(current, prev);

    return {
      current: currentStats,
      prev: prevStats,
      changes: {
        income: calculateChange(currentStats.income, prevStats.income),
        expenses: calculateChange(currentStats.expenses, prevStats.expenses),
        net: calculateChange(currentStats.net, prevStats.net),
      },
      prevPeriodLabel: `${formatDayMonth(prevStart)} - ${formatDayMonth(prevEnd)}`,
    };
  }, [transactions, dateRange, formatDayMonth]);

  const renderChange = (
    percent: number | null,
    type: "income" | "expense" | "net",
    current: number
  ) => {
    if (percent === 0) return <span className="text-gray-500 text-xs">0%</span>;

    // No baseline (previous period was 0): the direction is the sign of the current value, the
    // size is "new".
    const isPositive = percent === null ? current > 0 : percent > 0;

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
        className={cn("text-xs flex items-center gap-0.5", isGood ? "text-success" : "text-danger")}
      >
        <Icon
          name={isPositive ? "arrow_upward" : "arrow_downward"}
          size={12}
          className={isGood ? "text-success" : "text-danger"}
        />
        {percent === null ? "new" : `${Math.abs(percent).toFixed(1)}%`}
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
            {renderChange(comparisonData.changes.income, "income", comparisonData.current.income)}
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-bold text-success">
              {formatCurrencyWithSign(comparisonData.current.income)}
            </span>
            <span className="text-xs text-gray-500">
              was {formatCurrency(comparisonData.prev.income)}
            </span>
          </div>
        </div>

        {/* Expenses */}
        <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Total Expenses</span>
            {renderChange(comparisonData.changes.expenses, "expense", comparisonData.current.expenses)}
          </div>
          <div className="flex items-baseline justify-between">
            <span className={cn("text-xl font-bold", amountTone(comparisonData.current.expenses, "text-danger"))}>
              {formatCurrency(-comparisonData.current.expenses)}
            </span>
            <span className="text-xs text-gray-500">
              was {formatCurrency(comparisonData.prev.expenses)}
            </span>
          </div>
        </div>

        {/* Net */}
        <div className="p-3 bg-gray-800/30 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-400">Net Flow</span>
            {renderChange(comparisonData.changes.net, "net", comparisonData.current.net)}
          </div>
          <div className="flex items-baseline justify-between">
            <span
              className={cn(
                "text-xl font-bold",
                comparisonData.current.net >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatCurrencyWithSign(comparisonData.current.net)}
            </span>
            <span className="text-xs text-gray-500">
              was {formatCurrency(comparisonData.prev.net)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default PeriodComparison;
