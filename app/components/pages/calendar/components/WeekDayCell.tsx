"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils/cn";
import { Icon, Badge, ContextMenu } from "@/components/common";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { formatDate } from "@/lib/utils/dateUtils";
import { TRANSACTION_STATUS_BADGE_VARIANT } from "@/lib/constants";
import { useModal } from "@/components/modals";
import { STATUS_COLORS } from "../constants";
import type { CalendarDay } from "../types";
import { Transaction } from "@/lib/types";
import DraggableDayChip from "./DraggableDayChip";

interface IProps {
  day: CalendarDay;
  isSelected: boolean;
  onClick: () => void;
  onTransactionClick?: (transaction: Transaction) => void;
}

const WeekDayCell: React.FC<IProps> = ({ day, isSelected, onClick, onTransactionClick }) => {
  const { formatCurrency } = useCurrency();
  const router = useRouter();
  const { openModal } = useModal();
  const { date, isToday, dayBalance } = day;
  const transactions = dayBalance?.transactions || [];
  const dateKey = formatDate(date);
  const { isOver, setNodeRef } = useDroppable({
    id: dateKey,
    data: { date: dateKey },
  });

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Handle right-click
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Context menu items
  const contextMenuItems = [
    {
      id: "add-transaction",
      label: "Add Transaction",
      icon: "receipt_long",
      onClick: () => {
        openModal("ManualTransactionFormModal", {
          prefilledDate: dateKey,
        });
      },
    },
    {
      id: "add-income",
      label: "Add Income",
      icon: "trending_up",
      variant: "success" as const,
      onClick: () => {
        router.push("/income");
      },
      divider: true,
    },
    {
      id: "add-expense",
      label: "Add Expense",
      icon: "trending_down",
      variant: "default" as const,
      onClick: () => {
        router.push("/expenses");
      },
    },
  ];

  return (
    <>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[200px] flex flex-col border border-gray-800 cursor-pointer transition-all",
          isSelected && "ring-2 ring-primary bg-primary/10",
          isOver && "ring-2 ring-primary/80",
          isToday && "border-primary",
          "hover:bg-gray-800/30"
        )}
        onClick={onClick}
        onContextMenu={handleContextMenu}
      >
        {/* Date header */}
        <div
          className={cn(
            "p-3 border-b border-gray-800 flex flex-col items-center justify-between",
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

        {/* Transactions list */}
        <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[300px]">
          {transactions.length > 0 ? (
            transactions.map((t) => {
              const isIncome = t.type === "income";
              const isSkipped = t.status === "skipped";

              return (
                <DraggableDayChip
                  key={`${t.id}-chip`}
                  transaction={t}
                  onClick={() => onTransactionClick?.(t)}
                >
                  <div
                    className={cn(
                      "p-2 rounded-lg cursor-pointer transition-colors",
                      isSkipped
                        ? "bg-gray-700/30 hover:bg-gray-700/50"
                        : isIncome
                          ? "bg-success/10 hover:bg-success/20"
                          : "bg-danger/10 hover:bg-danger/20"
                    )}
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
                    <span
                      className={cn(
                        "text-sm font-medium truncate",
                        isSkipped ? "text-gray-500" : "text-white"
                      )}
                    >
                      {t.name}
                    </span>
                    <div className="flex flex-col items-start justify-center gap-2 mt-1">
                      <span className="text-xs text-gray-500">{t.category}</span>
                      <Badge
                        variant={TRANSACTION_STATUS_BADGE_VARIANT[t.status]}
                        className="text-xs"
                      >
                        {t.status}
                      </Badge>
                    </div>
                  </div>
                </DraggableDayChip>
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

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
};

export default WeekDayCell;
