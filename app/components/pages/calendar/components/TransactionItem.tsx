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
        "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
        bgColor
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div className={cn("w-8 h-8 rounded-full flex items-center justify-center", iconBgColor)}>
          <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size="sm" />
        </div>
        <div>
          <p className={cn("font-medium text-sm", isSkipped ? "text-gray-500" : "text-white")}>
            {transaction.name}
          </p>
          <p className="text-xs text-gray-400">{transaction.category}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={cn("font-bold", amountColor)}>
          {isIncome ? "+" : "-"}$
          {(transaction.actualAmount ?? transaction.projectedAmount).toLocaleString()}
        </p>
        <Badge
          variant={
            transaction.status === "completed"
              ? "success"
              : transaction.status === "skipped"
                ? "default"
                : transaction.status === "pending"
                  ? "warning"
                  : "default"
          }
          className="text-xs"
        >
          {transaction.status}
        </Badge>
      </div>
    </div>
  );
};

export default TransactionItem;
