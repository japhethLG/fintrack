"use client";

import React, { useMemo, useCallback } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { Card, Icon } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/dateUtils";

interface ChartDataPoint {
  date: string;
  day: number;
  balance: number;
  label: string;
}

interface IProps {
  data: ChartDataPoint[];
}

// Custom tick component for XAxis that highlights today's date
const CustomXAxisTick = ({
  x,
  y,
  payload,
  todayLabel,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
  todayLabel: string | null;
}) => {
  const isToday = payload?.value === todayLabel;

  return (
    <g transform={`translate(${x},${y})`}>
      {isToday && <circle cx={0} cy={8} r={12} fill="#135bec" opacity={0.3} />}
      <text
        x={0}
        y={8}
        dy={4}
        textAnchor="middle"
        fill={isToday ? "#135bec" : "#6c757d"}
        fontSize={12}
        fontWeight={isToday ? 600 : 400}
      >
        {payload?.value}
      </text>
    </g>
  );
};

const CashFlowChart: React.FC<IProps> = ({ data }) => {
  const { currencySymbol, formatCurrency } = useCurrency();

  // Calculate opening and closing balances
  const { openingBalance, closingBalance, change, changePercent } = useMemo(() => {
    if (data.length === 0) {
      return { openingBalance: null, closingBalance: null, change: null, changePercent: null };
    }

    const opening = data[0].balance;
    const closing = data[data.length - 1].balance;
    const diff = closing - opening;
    const percent = opening !== 0 ? ((diff / Math.abs(opening)) * 100).toFixed(1) : null;

    return {
      openingBalance: opening,
      closingBalance: closing,
      change: diff,
      changePercent: percent,
    };
  }, [data]);

  /**
   * Formats a value for Y-axis display, choosing the appropriate scale
   */
  const formatYAxisValue = useCallback(
    (value: number, maxValue: number): string => {
      const absMax = Math.abs(maxValue);

      // For values >= 10k, show in "k" format
      if (absMax >= 10000) {
        return `${currencySymbol}${(value / 1000).toFixed(0)}k`;
      }
      // For values >= 1k, show in "k" format with one decimal
      if (absMax >= 1000) {
        return `${currencySymbol}${(value / 1000).toFixed(1)}k`;
      }
      // For smaller values, show the full number
      return formatCurrency(value);
    },
    [currencySymbol, formatCurrency]
  );
  // Calculate the max value for smart formatting
  const maxBalance = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map((d) => Math.abs(d.balance)));
  }, [data]);

  // Find today's label by matching the date
  const todayLabel = useMemo(() => {
    const today = formatDate(new Date());
    const todayData = data.find((d) => d.date === today);
    return todayData?.label || null;
  }, [data]);

  const hasData = data.length > 0;

  return (
    <Card className="lg:col-span-2" padding="md">
      {/* Header with title and change badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Icon name="show_chart" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Projected Cash Flow</h3>
            <p className="text-xs text-gray-400">Opening to closing balance</p>
          </div>
        </div>
        {change !== null && (
          <div
            className={cn(
              "flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium",
              change >= 0 ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            )}
          >
            <Icon name={change >= 0 ? "trending_up" : "trending_down"} size={16} />
            <span>
              {change >= 0 ? "+" : ""}
              {formatCurrency(change, { maximumFractionDigits: 0 })}
            </span>
            {changePercent && (
              <span className="text-xs opacity-70">
                ({change >= 0 ? "+" : ""}
                {changePercent}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Opening and Closing Balance */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Opening Balance */}
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="login" size={14} className="text-gray-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wide">Opening</span>
          </div>
          <p className="text-xl font-bold text-white">
            {openingBalance !== null
              ? formatCurrency(openingBalance, { maximumFractionDigits: 0 })
              : "—"}
          </p>
        </div>

        {/* Closing Balance */}
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex items-center gap-2 mb-1">
            <Icon name="logout" size={14} className="text-gray-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wide">Closing</span>
          </div>
          <p
            className={cn(
              "text-xl font-bold",
              closingBalance !== null && closingBalance < 0 ? "text-danger" : "text-white"
            )}
          >
            {closingBalance !== null
              ? formatCurrency(closingBalance, { maximumFractionDigits: 0 })
              : "—"}
          </p>
        </div>
      </div>

      <div className="h-[200px] w-full">
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
                tick={(props) => <CustomXAxisTick {...props} todayLabel={todayLabel} />}
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
                formatter={(value: number) => [formatCurrency(value), "Balance"]}
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
