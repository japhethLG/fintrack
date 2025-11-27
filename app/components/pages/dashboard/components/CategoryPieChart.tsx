"use client";

import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { Card } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface CategoryData {
  name: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

interface IProps {
  data: CategoryData[];
  totalExpenses: number;
}

// Placeholder data for empty state - creates a subtle donut ring
const PLACEHOLDER_DATA = [{ name: "placeholder", value: 1, color: "#374151" }];

const CategoryPieChart: React.FC<IProps> = ({ data, totalExpenses }) => {
  const { formatCurrency } = useCurrency();
  const hasData = data.length > 0;
  const chartData = hasData ? data : PLACEHOLDER_DATA;

  return (
    <Card padding="md" className="flex flex-col">
      <h3 className="text-lg font-bold text-white mb-4">Spending by Category</h3>
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
                formatter={(value: number) => [formatCurrency(value), "Expenses"]}
              />
            )}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-0">
          {hasData ? (
            <>
              <span className="text-gray-400 text-xs">Total</span>
              <span className="text-white font-bold text-lg">
                {formatCurrency(totalExpenses, { maximumFractionDigits: 0 })}
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
      {hasData ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.slice(0, 4).map((entry) => (
            <div key={entry.name} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-xs text-gray-300 capitalize truncate">{entry.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">No spending data yet</p>
        </div>
      )}
    </Card>
  );
};

export default CategoryPieChart;
