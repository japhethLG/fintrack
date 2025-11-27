"use client";

import React from "react";
import { cn } from "@/lib/utils/cn";
import { Icon, Badge } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { STATUS_COLORS } from "../constants";
import type { CalendarDay } from "../types";
import { Transaction } from "@/lib/types";

interface IProps {
  day: CalendarDay;
  isSelected: boolean;
  onClick: () => void;
  onTransactionClick?: (transaction: Transaction) => void;
}

const WeekDayCell: React.FC<IProps> = ({ day, isSelected, onClick, onTransactionClick }) => {
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();
  const { date, isToday, dayBalance } = day;
  const transactions = dayBalance?.transactions || [];

  // Get status variant for badge
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "success";
      case "skipped":
        return "default";
      case "pending":
        return "warning";
      default:
        return "default";
    }
  };

  return (
    <div
      className={cn(
        "min-h-[200px] flex flex-col border border-gray-800 cursor-pointer transition-all",
        isSelected && "ring-2 ring-primary bg-primary/10",
        isToday && "border-primary",
        "hover:bg-gray-800/30"
      )}
      onClick={onClick}
    >
      {/* Date header */}
      <div
        className={cn(
          "p-3 border-b border-gray-800 flex items-center justify-between",
          isToday && "bg-primary/10"
        )}
      >
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-lg font-bold",
              isToday
                ? "bg-primary text-white w-8 h-8 rounded-full flex items-center justify-center"
                : "text-white"
            )}
          >
            {date.getDate()}
          </span>
          <span className="text-sm text-gray-400">
            {date.toLocaleDateString("en-US", { weekday: "short" })}
          </span>
        </div>

        {/* Balance indicator */}
        {dayBalance && (
          <span className={cn("text-sm font-medium", STATUS_COLORS[dayBalance.status])}>
            {formatCurrency(dayBalance.closingBalance)}
          </span>
        )}
      </div>

      {/* Day totals */}
      {dayBalance && (dayBalance.totalIncome > 0 || dayBalance.totalExpenses > 0) && (
        <div className="px-3 py-2 border-b border-gray-800/50 flex gap-3 text-xs">
          {dayBalance.totalIncome > 0 && (
            <span className="text-success">{formatCurrencyWithSign(dayBalance.totalIncome)}</span>
          )}
          {dayBalance.totalExpenses > 0 && (
            <span className="text-danger">-{formatCurrency(dayBalance.totalExpenses)}</span>
          )}
        </div>
      )}

      {/* Transactions list */}
      <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[300px]">
        {transactions.length > 0 ? (
          transactions.map((t) => {
            const isIncome = t.type === "income";
            const isSkipped = t.status === "skipped";

            return (
              <div
                key={t.id}
                className={cn(
                  "p-2 rounded-lg cursor-pointer transition-colors",
                  isSkipped
                    ? "bg-gray-700/30 hover:bg-gray-700/50"
                    : isIncome
                      ? "bg-success/10 hover:bg-success/20"
                      : "bg-danger/10 hover:bg-danger/20"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onTransactionClick?.(t);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon
                      name={isIncome ? "arrow_downward" : "arrow_upward"}
                      size="sm"
                      className={cn(
                        isSkipped ? "text-gray-500" : isIncome ? "text-success" : "text-danger"
                      )}
                    />
                    <span
                      className={cn(
                        "text-sm font-medium truncate",
                        isSkipped ? "text-gray-500" : "text-white"
                      )}
                    >
                      {t.name}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-bold whitespace-nowrap",
                      isSkipped ? "text-gray-500" : isIncome ? "text-success" : "text-danger"
                    )}
                  >
                    {isIncome ? "+" : "-"}
                    {formatCurrency(t.actualAmount ?? t.projectedAmount)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-gray-500">{t.category}</span>
                  <Badge variant={getStatusVariant(t.status)} className="text-xs">
                    {t.status}
                  </Badge>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center h-full py-6 text-gray-500">
            <Icon name="event_available" size={24} className="mb-1" />
            <span className="text-xs">No transactions</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default WeekDayCell;
