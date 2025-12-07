"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface IProps {
  transaction: Transaction;
  onClick?: () => void;
}

const TransactionItem: React.FC<IProps> = ({ transaction, onClick }) => {
  const isIncome = transaction.type === "income";
  const isSkipped = transaction.status === "skipped";

  // Determine colors based on type and skipped status
  const bgColor = isSkipped
    ? "bg-gray-700/30 hover:bg-gray-700/50"
    : isIncome
      ? "bg-success/10 hover:bg-success/20"
      : "bg-danger/10 hover:bg-danger/20";

  const iconBgColor = isSkipped
    ? "bg-gray-600/30 text-gray-500"
    : isIncome
      ? "bg-success/20 text-success"
      : "bg-danger/20 text-danger";

  const amountColor = isSkipped ? "text-gray-500" : isIncome ? "text-success" : "text-danger";

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors",
        bgColor
      )}
      onClick={onClick}
    >
      {/* Icon */}
      <div className={cn("w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0", iconBgColor)}>
        <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size="sm" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Top row: Name and Amount */}
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className={cn("font-medium text-sm truncate", isSkipped ? "text-gray-500" : "text-white")}>
            {transaction.name}
          </p>
          <p className={cn("font-bold text-sm whitespace-nowrap flex-shrink-0", amountColor)}>
            {isIncome ? "+" : "-"}$
            {(transaction.actualAmount ?? transaction.projectedAmount).toLocaleString()}
          </p>
        </div>

        {/* Bottom row: Category and Status */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400 truncate">{transaction.category}</p>
          <Badge
            variant={
              transaction.status === "completed"
                ? "success"
                : transaction.status === "skipped"
                  ? "default"
                  : "default"
            }
            className="text-xs flex-shrink-0"
          >
            {transaction.status}
          </Badge>
        </div>
      </div>
    </div>
  );
};

export default TransactionItem;
