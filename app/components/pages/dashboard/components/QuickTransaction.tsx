"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { formatDate } from "@/lib/utils/dateUtils";

interface IProps {
  transaction: Transaction;
  onClick: () => void;
}

const QuickTransaction: React.FC<IProps> = ({ transaction, onClick }) => {
  const { formatCurrency } = useCurrency();
  const isIncome = transaction.type === "income";
  const today = formatDate(new Date()); // YYYY-MM-DD
  const isPast = transaction.scheduledDate < today; // String comparison (today is NOT past)

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
        isPast && transaction.status !== "completed"
          ? "bg-danger/10 hover:bg-danger/20 border border-danger/20"
          : isIncome
            ? "bg-success/10 hover:bg-success/20"
            : "bg-gray-800/50 hover:bg-gray-800"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center",
            isIncome ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
          )}
        >
          <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size="sm" />
        </div>
        <div>
          <p className="font-medium text-white text-sm">{transaction.name}</p>
          <p className="text-xs text-gray-400">
            {new Date(transaction.scheduledDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className={cn("font-bold", isIncome ? "text-success" : "text-white")}>
          {isIncome ? "+" : "-"}
          {formatCurrency(transaction.projectedAmount)}
        </p>
        <Badge
          variant={transaction.status === "completed" ? "success" : isPast ? "danger" : "warning"}
          className="text-xs"
        >
          {isPast && transaction.status !== "completed" ? "Overdue" : transaction.status}
        </Badge>
      </div>
    </div>
  );
};

export default QuickTransaction;
