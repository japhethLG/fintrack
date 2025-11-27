"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFinancial } from "@/contexts/FinancialContext";
import { IncomeSource, ExpenseRule, IncomeFrequency } from "@/lib/types";
import { Card, Button, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

const getMonthlyMultiplier = (frequency: IncomeFrequency): number => {
  switch (frequency) {
    case "daily":
      return 30;
    case "weekly":
      return 52 / 12;
    case "bi-weekly":
      return 26 / 12;
    case "semi-monthly":
      return 2;
    case "monthly":
      return 1;
    case "quarterly":
      return 1 / 3;
    case "yearly":
      return 1 / 12;
    default:
      return 0;
  }
};

const RecurringSummaryWidget: React.FC = () => {
  const router = useRouter();
  const { incomeSources, expenseRules } = useFinancial();
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();

  const stats = useMemo(() => {
    const activeIncome = incomeSources.filter((s) => s.isActive);
    const activeExpenses = expenseRules.filter((r) => r.isActive);

    const monthlyIncome = activeIncome.reduce((sum, source) => {
      if (source.frequency === "one-time") return sum;
      return sum + source.amount * getMonthlyMultiplier(source.frequency);
    }, 0);

    const monthlyExpenses = activeExpenses.reduce((sum, rule) => {
      // Handle special expense types
      if (rule.expenseType === "cash_loan" && rule.loanConfig) {
        return sum + rule.loanConfig.monthlyPayment;
      }
      if (rule.expenseType === "installment" && rule.installmentConfig) {
        // Assuming installments are monthly for now
        return sum + rule.installmentConfig.installmentAmount;
      }
      if (rule.expenseType === "one-time") return sum;

      // Standard recurring
      return sum + rule.amount * getMonthlyMultiplier(rule.frequency as IncomeFrequency);
    }, 0);

    return {
      activeIncomeCount: activeIncome.length,
      activeExpenseCount: activeExpenses.length,
      monthlyIncome,
      monthlyExpenses,
      net: monthlyIncome - monthlyExpenses,
    };
  }, [incomeSources, expenseRules]);

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/20 rounded-lg text-primary">
          <Icon name="repeat" size={20} />
        </div>
        <div>
          <h3 className="font-bold text-white">Recurring Summary</h3>
          <p className="text-xs text-gray-400">Estimated monthly totals</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Income Row */}
        <div className="flex items-center justify-between p-3 bg-dark-800 rounded-lg border border-gray-800">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Monthly Income</p>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">
                {formatCurrency(stats.monthlyIncome, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-xs bg-dark-700 px-1.5 py-0.5 rounded text-gray-400">
                {stats.activeIncomeCount} sources
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="arrow_forward" size={16} />}
            onClick={() => router.push("/income")}
          />
        </div>

        {/* Expenses Row */}
        <div className="flex items-center justify-between p-3 bg-dark-800 rounded-lg border border-gray-800">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Monthly Expenses</p>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white">
                {formatCurrency(stats.monthlyExpenses, { maximumFractionDigits: 0 })}
              </span>
              <span className="text-xs bg-dark-700 px-1.5 py-0.5 rounded text-gray-400">
                {stats.activeExpenseCount} rules
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icon name="arrow_forward" size={16} />}
            onClick={() => router.push("/expenses")}
          />
        </div>

        {/* Net Row */}
        <div className="pt-2 border-t border-gray-800 flex justify-between items-center">
          <span className="text-sm text-gray-400">Net Recurring</span>
          <span
            className={cn(
              "font-bold",
              stats.net >= 0 ? "text-success" : "text-danger"
            )}
          >
            {formatCurrencyWithSign(stats.net, { maximumFractionDigits: 0 })}
            <span className="text-xs font-normal text-gray-500 ml-1">/mo</span>
          </span>
        </div>
      </div>
    </Card>
  );
};

export default RecurringSummaryWidget;

