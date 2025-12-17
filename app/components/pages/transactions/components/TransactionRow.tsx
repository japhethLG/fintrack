"use client";

import React from "react";
import { Transaction } from "@/lib/types";
import { Button, Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { STATUS_VARIANTS } from "../constants";

interface IProps {
  transaction: Transaction;
  onAction: () => void;
}

const TransactionRow: React.FC<IProps> = ({ transaction, onAction }) => {
  const { formatCurrency, currencySymbol } = useCurrency();
  const isIncome = transaction.type === "income";
  const amount = transaction.actualAmount ?? transaction.projectedAmount;
  const hasVariance = transaction.variance && transaction.variance !== 0;

  return (
    <div
      className={cn(
        "p-4 border-b border-gray-800 hover:bg-gray-800/30 transition-colors cursor-pointer",
        transaction.status === "skipped" && "opacity-50"
      )}
      onClick={onAction}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Type indicator */}
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              isIncome ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            )}
          >
            <Icon name={isIncome ? "arrow_downward" : "arrow_upward"} size="sm" />
          </div>

          {/* Details */}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-white">{transaction.name}</span>
              {transaction.paymentBreakdown && (
                <span className="text-xs text-gray-500">
                  (#{transaction.paymentBreakdown.paymentNumber})
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default" className="text-xs">
                {transaction.category}
              </Badge>
              <span className="text-xs text-gray-500">
                {transaction.sourceType === "manual" ? "Manual" : "Scheduled"}
              </span>
            </div>
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-6">
          {/* Date */}
          <div className="text-right hidden md:block">
            <p className="text-sm text-gray-300">
              {new Date(transaction.actualDate || transaction.scheduledDate).toLocaleDateString()}
            </p>
            {transaction.actualDate && transaction.actualDate !== transaction.scheduledDate && (
              <p className="text-xs text-gray-500 line-through">
                {new Date(transaction.scheduledDate).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Amount */}
          <div className="text-right min-w-[100px]">
            <p className={cn("font-bold", isIncome ? "text-success" : "text-danger")}>
              {isIncome ? "+" : "-"}
              {formatCurrency(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            {hasVariance && (
              <p
                className={cn(
                  "text-xs",
                  transaction.variance! > 0
                    ? isIncome
                      ? "text-success"
                      : "text-danger"
                    : isIncome
                      ? "text-danger"
                      : "text-success"
                )}
              >
                {transaction.variance! > 0 ? "+" : ""}
                {currencySymbol}
                {transaction.variance?.toFixed(2)}
              </p>
            )}
          </div>

          {/* Status */}
          <div className="min-w-[100px]">
            <Badge variant={STATUS_VARIANTS[transaction.status]} className="capitalize">
              {transaction.status}
            </Badge>
          </div>

          {/* Action */}
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="chevron_right" size="sm" />}
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default TransactionRow;
