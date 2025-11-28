"use client";

import React from "react";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface IProps {
  /** Opening balance for the first day of the period */
  openingBalance: number | null;
  /** Closing balance for the last day of the period */
  closingBalance: number | null;
  /** View mode - affects the label text */
  viewMode: "month" | "week";
  /** Optional: Start date label */
  startDateLabel?: string;
  /** Optional: End date label */
  endDateLabel?: string;
}

const PeriodBalanceSummary: React.FC<IProps> = ({
  openingBalance,
  closingBalance,
  viewMode,
  startDateLabel,
  endDateLabel,
}) => {
  const { formatCurrency } = useCurrency();

  const periodLabel = viewMode === "month" ? "Monthly" : "Weekly";
  const change = openingBalance !== null && closingBalance !== null
    ? closingBalance - openingBalance
    : null;

  const changePercent = openingBalance && change !== null
    ? ((change / Math.abs(openingBalance)) * 100).toFixed(1)
    : null;

  return (
    <Card padding="md" className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Icon name="account_balance_wallet" size={20} className="text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{periodLabel} Balance Overview</h3>
            <p className="text-xs text-gray-400">
              {startDateLabel && endDateLabel
                ? `${startDateLabel} → ${endDateLabel}`
                : "Opening to closing balance"}
            </p>
          </div>
        </div>
        {change !== null && (
          <div className={cn(
            "flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium",
            change >= 0
              ? "bg-success/20 text-success"
              : "bg-danger/20 text-danger"
          )}>
            <Icon
              name={change >= 0 ? "trending_up" : "trending_down"}
              size={16}
            />
            <span>
              {change >= 0 ? "+" : ""}{formatCurrency(change, { maximumFractionDigits: 0 })}
            </span>
            {changePercent && (
              <span className="text-xs opacity-70">
                ({change >= 0 ? "+" : ""}{changePercent}%)
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Opening Balance */}
        <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="login" size={16} className="text-gray-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wide">Opening</span>
          </div>
          <p className="text-2xl font-bold text-white">
            {openingBalance !== null
              ? formatCurrency(openingBalance, { maximumFractionDigits: 0 })
              : "—"}
          </p>
          {startDateLabel && (
            <p className="text-xs text-gray-500 mt-1">{startDateLabel}</p>
          )}
        </div>

        {/* Closing Balance */}
        <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="logout" size={16} className="text-gray-400" />
            <span className="text-xs text-gray-400 uppercase tracking-wide">Closing</span>
          </div>
          <p className={cn(
            "text-2xl font-bold",
            closingBalance !== null && closingBalance < 0
              ? "text-danger"
              : "text-white"
          )}>
            {closingBalance !== null
              ? formatCurrency(closingBalance, { maximumFractionDigits: 0 })
              : "—"}
          </p>
          {endDateLabel && (
            <p className="text-xs text-gray-500 mt-1">{endDateLabel}</p>
          )}
        </div>
      </div>
    </Card>
  );
};

export default PeriodBalanceSummary;

