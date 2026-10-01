"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { useFinancial } from "@/contexts/FinancialContext";
import { Card, Button, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import {
  isExpenseRuleCurrent,
  isIncomeSourceCurrent,
  monthBounds,
  recurringPeriodTotals,
} from "@/lib/logic/forecasting";

const RecurringSummaryWidget: React.FC = () => {
  const router = useRouter();
  const { incomeSources, expenseRules, transactions } = useFinancial();
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();

  const stats = useMemo(() => {
    const today = getTodayKey();
    // "Active" means switched on AND still producing occurrences: an ended source, a repaid loan,
    // a settled card or a fully paid installment plan is not active any more.
    const activeIncome = incomeSources.filter((s) => isIncomeSourceCurrent(s, today));
    const activeExpenses = expenseRules.filter((r) => isExpenseRuleCurrent(r, today));

    // The recurring occurrences of THIS calendar month: five Fridays are five payments.
    const { start, end } = monthBounds(today);
    const month = recurringPeriodTotals(
      transactions,
      incomeSources,
      expenseRules,
      start,
      end,
      today
    );

    return {
      monthLabel: dayjs(parseDate(today)).format("MMMM YYYY"),
      activeIncomeCount: activeIncome.length,
      activeExpenseCount: activeExpenses.length,
      monthlyIncome: month.income,
      monthlyExpenses: month.expenses,
      net: month.net,
    };
  }, [incomeSources, expenseRules, transactions]);

  return (
    <Card padding="md">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-primary/20 rounded-lg text-primary">
          <Icon name="repeat" size={20} />
        </div>
        <div>
          <h3 className="font-bold text-white">Recurring Summary</h3>
          <p className="text-xs text-gray-400">Scheduled for {stats.monthLabel}</p>
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
          <span className={cn("font-bold", stats.net >= 0 ? "text-success" : "text-danger")}>
            {formatCurrencyWithSign(stats.net, { maximumFractionDigits: 0 })}
            <span className="text-xs font-normal text-gray-500 ml-1">this month</span>
          </span>
        </div>
      </div>
    </Card>
  );
};

export default RecurringSummaryWidget;
