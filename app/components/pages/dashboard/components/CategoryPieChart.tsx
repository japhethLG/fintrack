"use client";

import React, { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { Card, Icon, Button } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { cn } from "@/lib/utils/cn";

interface CategoryData {
  name: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

interface IProps {
  expenseData: CategoryData[];
  incomeData: CategoryData[];
  totalExpenses: number;
  totalIncome: number;
}

// Placeholder data for empty state - creates a subtle donut ring
const PLACEHOLDER_DATA = [{ name: "placeholder", value: 1, color: "#374151" }];

const CategoryPieChart: React.FC<IProps> = ({
  expenseData,
  incomeData,
  totalExpenses,
  totalIncome,
}) => {
  const { formatCurrency } = useCurrency();
  const [viewType, setViewType] = useState<"expense" | "income">("expense");

  const isExpenseView = viewType === "expense";
  const currentData = isExpenseView ? expenseData : incomeData;
  const currentTotal = isExpenseView ? totalExpenses : totalIncome;
  const hasData = currentData.length > 0;
  const chartData = hasData ? currentData : PLACEHOLDER_DATA;

  return (
    <Card padding="md" className="flex flex-col">
      {/* Header with Toggle */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">
          {isExpenseView ? "Spending" : "Income"} by Category
        </h3>
        <div className="flex bg-gray-800 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewType("expense")}
            startIcon={<Icon name="remove" size={12} />}
            className={cn(
              "h-7 px-2 text-xs rounded-md",
              isExpenseView
                ? "bg-danger/20 text-danger hover:bg-danger/30"
                : "text-gray-400 hover:text-gray-300 hover:bg-transparent"
            )}
          >
            Expenses
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewType("income")}
            startIcon={<Icon name="add" size={12} />}
            className={cn(
              "h-7 px-2 text-xs rounded-md",
              !isExpenseView
                ? "bg-success/20 text-success hover:bg-success/30"
                : "text-gray-400 hover:text-gray-300 hover:bg-transparent"
            )}
          >
            Income
          </Button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 flex items-center justify-center relative">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart className="z-10">
            <Pie
              data={chartData}
              innerRadius={50}
              outerRadius={70}
              paddingAngle={hasData ? 5 : 0}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            {hasData && (
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  borderColor: "#e2e8f0",
                  borderRadius: "8px",
                  color: "#000",
                }}
                formatter={(value: number) => [
                  formatCurrency(value),
                  isExpenseView ? "Expenses" : "Income",
                ]}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
          {hasData ? (
            <>
              <span className="text-gray-400 text-xs">Total</span>
              <span
                className={cn(
                  "font-bold text-lg",
                  isExpenseView ? "text-danger" : "text-success"
                )}
              >
                {formatCurrency(currentTotal, { maximumFractionDigits: 0 })}
              </span>
            </>
          ) : (
            <>
              <span className="text-gray-400 text-xs">Total</span>
              <span className="text-gray-500 font-bold text-lg">{formatCurrency(0)}</span>
            </>
          )}
        </div>
      </div>

      {/* Legend - Show all 6 categories */}
      {hasData ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {currentData.slice(0, 6).map((entry) => (
            <div key={entry.name} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-xs text-gray-300 capitalize truncate">{entry.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">
            No {isExpenseView ? "spending" : "income"} data yet
          </p>
        </div>
      )}
    </Card>
  );
};

export default CategoryPieChart;

