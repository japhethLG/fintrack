"use client";

import React from "react";
import { ExpenseRule } from "@/lib/types";
import { Icon, Badge } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { EXPENSE_TYPE_ICONS, EXPENSE_TYPE_LABELS, FREQUENCY_LABELS } from "../constants";

interface IProps {
  rule: ExpenseRule;
  isSelected: boolean;
  onClick: () => void;
}

const ExpenseRuleCard: React.FC<IProps> = ({ rule, isSelected, onClick }) => {
  const { formatCurrency } = useCurrency();
  const getProgress = () => {
    if (rule.loanConfig) {
      const paid = rule.loanConfig.principalAmount - rule.loanConfig.currentBalance;
      return (paid / rule.loanConfig.principalAmount) * 100;
    }
    if (rule.installmentConfig) {
      return (
        (rule.installmentConfig.installmentsPaid / rule.installmentConfig.installmentCount) * 100
      );
    }
    return null;
  };

  const progress = getProgress();

  return (
    <div
      className={cn(
        "p-4 border-b border-gray-800 cursor-pointer transition-all",
        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-gray-800/50"
      )}
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              rule.isActive ? "bg-danger/20 text-danger" : "bg-gray-700 text-gray-400"
            )}
          >
            <Icon name={EXPENSE_TYPE_ICONS[rule.expenseType] || "payments"} />
          </div>
          <div>
            <h4 className="font-bold text-white">{rule.name}</h4>
            <p className="text-xs text-gray-400">{EXPENSE_TYPE_LABELS[rule.expenseType]}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {rule.isPriority && (
            <Badge variant="warning" className="text-xs">
              Priority
            </Badge>
          )}
          {!rule.isActive && (
            <Badge variant="default" className="text-xs">
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-danger font-bold">
          {formatCurrency(rule.amount, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
        <p className="text-xs text-gray-500">{FREQUENCY_LABELS[rule.frequency]}</p>
      </div>

      {/* Progress bar for loans/installments */}
      {progress !== null && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Progress</span>
            <span>{progress.toFixed(0)}%</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-success rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseRuleCard;
