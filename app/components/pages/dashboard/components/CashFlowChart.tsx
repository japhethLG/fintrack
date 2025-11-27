"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card } from "@/components/common";

interface ChartDataPoint {
  date: string;
  day: number;
  balance: number;
  label: string;
}

interface IProps {
  data: ChartDataPoint[];
}

/**
 * Formats a value for Y-axis display, choosing the appropriate scale
 */
const formatYAxisValue = (value: number, maxValue: number): string => {
  const absValue = Math.abs(value);
  const absMax = Math.abs(maxValue);

  // For values >= 10k, show in "k" format
  if (absMax >= 10000) {
    return `$${(value / 1000).toFixed(0)}k`;
  }
  // For values >= 1k, show in "k" format with one decimal
  if (absMax >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  // For smaller values, show the full number
  return `$${value.toLocaleString()}`;
};

const CashFlowChart: React.FC<IProps> = ({ data }) => {
  // Calculate the max value for smart formatting
  const maxBalance = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map((d) => Math.abs(d.balance)));
  }, [data]);

  const hasData = data.length > 0;

  return (
    <Card className="lg:col-span-2" padding="md">
      <h3 className="text-lg font-bold text-white mb-6">Projected Cash Flow</h3>
      <div className="h-[300px] w-full">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#135bec" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#135bec" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#6c757d"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
                interval="preserveStartEnd"
                minTickGap={20}
              />
              <YAxis
                stroke="#6c757d"
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => formatYAxisValue(value, maxBalance)}
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
                formatter={(value: number) => [`$${value.toLocaleString()}`, "Balance"]}
                labelFormatter={(label) => label}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#135bec"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorBalance)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <p>No cash flow data available for this range</p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default CashFlowChart;
