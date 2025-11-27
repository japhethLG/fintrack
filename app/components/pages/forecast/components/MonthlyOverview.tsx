"use client";

import React from "react";
import { Card, Alert, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";

interface CategoryBreakdown {
  category: string;
  total: number;
  percentage: number;
}

interface IProps {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  savingsRate: number;
  billsAtRisk: number;
  categoryBreakdown: CategoryBreakdown[];
}

const MonthlyOverview: React.FC<IProps> = ({
  monthlyIncome,
  monthlyExpenses,
  monthlySurplus,
  savingsRate,
  billsAtRisk,
  categoryBreakdown,
}) => {
  return (
    <Card padding="lg" className="mb-8">
      <h3 className="text-lg font-bold text-white mb-4">Monthly Overview</h3>

      <div className="grid grid-cols-3 gap-6 mb-6">
        <div>
          <p className="text-gray-400 text-sm">Expected Income</p>
          <p className="text-2xl font-bold text-success">
            +${monthlyIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm">Expected Expenses</p>
          <p className="text-2xl font-bold text-danger">
            -${monthlyExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div>
          <p className="text-gray-400 text-sm">Net Change</p>
          <p
            className={cn(
              "text-2xl font-bold",
              monthlySurplus >= 0 ? "text-success" : "text-danger"
            )}
          >
            {monthlySurplus >= 0 ? "+" : ""}$
            {monthlySurplus.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Alerts */}
      {billsAtRisk > 0 && (
        <Alert
          variant="warning"
          icon={<Icon name="warning" />}
          title={`${billsAtRisk} Bill${billsAtRisk > 1 ? "s" : ""} at Risk`}
          className="mb-4"
        >
          <p className="text-sm">
            Some upcoming bills may not be covered by your current balance. Review your bill
            coverage in the dashboard.
          </p>
        </Alert>
      )}

      {savingsRate < 0 && (
        <Alert variant="error" icon={<Icon name="trending_down" />} title="Negative Cash Flow">
          <p className="text-sm">
            Your expenses exceed your income. Consider reducing expenses or finding additional
            income sources.
          </p>
        </Alert>
      )}

      {/* Top Categories */}
      {categoryBreakdown.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-800">
          <h4 className="text-sm font-medium text-gray-400 mb-3">Top Spending Categories</h4>
          <div className="space-y-2">
            {categoryBreakdown.slice(0, 5).map((cat, i) => (
              <div key={cat.category} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm w-4">{i + 1}.</span>
                  <span className="text-white capitalize">{cat.category}</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-danger rounded-full"
                      style={{ width: `${cat.percentage}%` }}
                    />
                  </div>
                  <span className="text-gray-400 text-sm w-16 text-right">
                    ${cat.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

export default MonthlyOverview;
