"use client";

import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { Card, Select } from "@/components/common";
import { Transaction } from "@/lib/types";
import { getIncomeExpenseChartData, getBestBucketType } from "@/lib/logic/healthScore";
import dayjs from "dayjs";

interface IProps {
  transactions: Transaction[];
  dateRange: {
    start: string;
    end: string;
  };
}

/**
 * Formats a value for Y-axis display, choosing the appropriate scale
 */
const formatYAxisValue = (value: number): string => {
  const absValue = Math.abs(value);

  // For values >= 10k, show in "k" format
  if (absValue >= 10000) {
    return `$${(value / 1000).toFixed(0)}k`;
  }
  // For values >= 1k, show in "k" format with one decimal
  if (absValue >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  // For smaller values, show the full number
  return `$${value.toLocaleString()}`;
};

const CHART_RANGE_OPTIONS = [
  { value: "global", label: "Selected Range" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
  { value: "last90", label: "Last 90 days" },
  { value: "ytd", label: "Year to date" },
];

const IncomeExpenseChart: React.FC<IProps> = ({ transactions, dateRange }) => {
  const [selectedRange, setSelectedRange] = useState("global");

  // Determine the actual range to use
  const activeRange = useMemo(() => {
    const today = dayjs();
    let start = dateRange.start;
    let end = dateRange.end;

    switch (selectedRange) {
      case "last7":
        start = today.subtract(7, "day").format("YYYY-MM-DD");
        end = today.format("YYYY-MM-DD");
        break;
      case "last30":
        start = today.subtract(30, "day").format("YYYY-MM-DD");
        end = today.format("YYYY-MM-DD");
        break;
      case "last90":
        start = today.subtract(90, "day").format("YYYY-MM-DD");
        end = today.format("YYYY-MM-DD");
        break;
      case "ytd":
        start = today.startOf("year").format("YYYY-MM-DD");
        end = today.format("YYYY-MM-DD");
        break;
      case "global":
      default:
        // Use passed prop
        break;
    }

    return { start, end };
  }, [selectedRange, dateRange]);

  const bucketType = getBestBucketType(activeRange.start, activeRange.end);
  const data = getIncomeExpenseChartData(
    transactions,
    activeRange.start,
    activeRange.end,
    bucketType
  );

  const hasData = data.some((d) => d.income > 0 || d.expenses > 0);

  return (
    <Card className="lg:col-span-2" padding="md">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-white">Income vs Expenses</h3>
          <span className="text-xs text-gray-400 capitalize">{bucketType} view</span>
        </div>
        <Select
          options={CHART_RANGE_OPTIONS}
          value={selectedRange}
          onChange={setSelectedRange}
          className="w-[140px] h-8 text-xs"
        />
      </div>

      <div className="h-[300px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#6c757d"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                stroke="#6c757d"
                tickLine={false}
                axisLine={false}
                tickFormatter={formatYAxisValue}
                tick={{ fontSize: 12 }}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#151c2c",
                  borderColor: "#2d3748",
                  borderRadius: "8px",
                  color: "#fff",
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]}
                labelStyle={{ color: "#9ca3af", marginBottom: "0.5rem" }}
                cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
              />
              <Legend wrapperStyle={{ paddingTop: "10px" }} />
              <ReferenceLine y={0} stroke="#4b5563" />
              <Bar
                dataKey="income"
                name="Income"
                fill="#22c55e"
                radius={[4, 4, 0, 0]}
                barSize={20}
              />
              <Bar
                dataKey="expenses"
                name="Expenses"
                fill="#ef4444"
                radius={[4, 4, 0, 0]}
                barSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <p>No transaction data for this period</p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default IncomeExpenseChart;
