"use client";

import React from "react";
import { UpcomingBill } from "@/lib/types";
import { Button, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

export interface BillItemProps {
  bill: UpcomingBill;
  onPay?: () => void;
}

export const BillItem: React.FC<BillItemProps> = ({ bill, onPay }) => {
  const { formatCurrency } = useCurrency();
  const { transaction, canCover, shortfall } = bill;
  const date = new Date(transaction.scheduledDate);

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border",
        canCover ? "bg-gray-800/30 border-gray-700" : "bg-danger/10 border-danger/30"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex flex-col items-center justify-center text-xs",
            canCover ? "bg-gray-700" : "bg-danger/20"
          )}
        >
          <span className="font-bold text-white">{date.getDate()}</span>
          <span className="text-gray-400">
            {date.toLocaleDateString("en-US", { month: "short" })}
          </span>
        </div>
        <div>
          <p className="font-medium text-white text-sm">{transaction.name}</p>
          <p className="text-xs text-gray-400">{transaction.category}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-bold text-white">{formatCurrency(transaction.projectedAmount)}</p>
          {canCover ? (
            <span className="text-xs text-success flex items-center gap-1">
              <Icon name="check_circle" size={12} />
              Covered
            </span>
          ) : (
            <span className="text-xs text-danger flex items-center gap-1">
              <Icon name="warning" size={12} />
              Need {shortfall ? formatCurrency(shortfall) : ""}
            </span>
          )}
        </div>

        {transaction.status !== "completed" && onPay && (
          <Button variant="ghost" size="sm" onClick={onPay}>
            Pay
          </Button>
        )}
      </div>
    </div>
  );
};

export default BillItem;

