"use client";

import React from "react";
import { useDroppable } from "@dnd-kit/core";
import { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/dateUtils";
import DraggableDayChip from "./DraggableDayChip";
import { STATUS_COLORS } from "../constants";
import type { CalendarDay } from "../types";

interface IProps {
  day: CalendarDay;
  isSelected: boolean;
  onClick: () => void;
  onTransactionClick?: (transaction: Transaction) => void;
}

const DayCell: React.FC<IProps> = ({ day, isSelected, onClick, onTransactionClick }) => {
  const { date, isCurrentMonth, isToday, isPast, dayBalance } = day;
  const transactions = dayBalance?.transactions || [];
  const hasTransactions = transactions.length > 0;
  const dateKey = formatDate(date);
  const { isOver, setNodeRef } = useDroppable({
    id: dateKey,
    data: { date: dateKey },
  });

  // Count only non-skipped transactions for the dots
  const activeTransactions = transactions.filter((t) => t.status !== "skipped");
  const incomeCount = activeTransactions.filter((t) => t.type === "income").length;
  const expenseCount = activeTransactions.filter((t) => t.type === "expense").length;

  // Helper to get transaction color based on type and status
  const getTransactionColor = (t: Transaction) => {
    if (t.status === "skipped") return "bg-gray-600/30 text-gray-500";
    return t.type === "income" ? "bg-success/20 text-success" : "bg-danger/20 text-danger";
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[100px] p-2 border border-gray-800 cursor-pointer transition-all",
        isCurrentMonth ? "bg-gray-900/50" : "bg-gray-900/20",
        isSelected && "ring-2 ring-primary bg-primary/10",
        isToday && "border-primary",
        isOver && "ring-2 ring-primary/80",
        !isCurrentMonth && "opacity-50"
      )}
      onClick={onClick}
    >
      {/* Date header */}
      <div className="flex items-start justify-between mb-1">
        <span
          className={cn(
            "text-sm font-medium",
            isToday
              ? "bg-primary text-white w-6 h-6 rounded-full flex items-center justify-center"
              : isCurrentMonth
                ? "text-white"
                : "text-gray-600"
          )}
        >
          {date.getDate()}
        </span>

        {/* Balance indicator */}
        {dayBalance && isCurrentMonth && (
          <span className={cn("text-xs font-medium", STATUS_COLORS[dayBalance.status])}>
            $
            {Math.abs(dayBalance.closingBalance).toLocaleString(undefined, {
              maximumFractionDigits: 0,
            })}
          </span>
        )}
      </div>

      {/* Transaction indicators */}
      {hasTransactions && isCurrentMonth && (
        <div className="mt-1 space-y-1">
          {/* Show first 2 transactions */}
          {transactions.slice(0, 2).map((t) => (
            <DraggableDayChip
              key={`${t.id}-chip`}
              transaction={t}
              onClick={() => onTransactionClick?.(t)}
            >
              <div className={cn("text-xs px-1.5 py-0.5 rounded truncate", getTransactionColor(t))}>
                {t.name}
              </div>
            </DraggableDayChip>
          ))}
          {transactions.length > 2 && (
            <div className="text-xs text-gray-500">+{transactions.length - 2} more</div>
          )}
        </div>
      )}

      {/* Summary dots */}
      {hasTransactions && isCurrentMonth && (
        <div className="flex gap-1 mt-2">
          {incomeCount > 0 && (
            <div className="flex items-center gap-0.5">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs text-success">{incomeCount}</span>
            </div>
          )}
          {expenseCount > 0 && (
            <div className="flex items-center gap-0.5">
              <div className="w-2 h-2 rounded-full bg-danger" />
              <span className="text-xs text-danger">{expenseCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DayCell;
