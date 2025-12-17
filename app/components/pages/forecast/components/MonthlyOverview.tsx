"use client";

import React, { useState } from "react";
import { Card, Alert, Icon, Button } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";

interface CategoryBreakdown {
  category: string;
  total: number;
  percentage: number;
}

interface IProps {
  actualIncome: number;
  actualExpenses: number;
  actualSurplus: number;
  actualSavingsRate: number;
  budgetedIncome: number;
  budgetedExpenses: number;
  budgetedSurplus: number;
  budgetedSavingsRate: number;
  billsAtRisk: number;
  categoryBreakdown: CategoryBreakdown[];
  periodLabel?: string;
}

const MonthlyOverview: React.FC<IProps> = ({
  actualIncome,
  actualExpenses,
  actualSurplus,
  actualSavingsRate,
  budgetedIncome,
  budgetedExpenses,
  budgetedSurplus,
  budgetedSavingsRate,
  billsAtRisk,
  categoryBreakdown,
  periodLabel,
}) => {
  const [viewMode, setViewMode] = useState<"actual" | "budgeted" | "comparison">("comparison");
  const { formatCurrency, formatCurrencyWithSign } = useCurrency();

  // Calculate variances
  const incomeVariance = actualIncome - budgetedIncome;
  const expenseVariance = actualExpenses - budgetedExpenses;
  const surplusVariance = actualSurplus - budgetedSurplus;
  const savingsRateVariance = actualSavingsRate - budgetedSavingsRate;

  const incomeVariancePercent = budgetedIncome > 0 ? (incomeVariance / budgetedIncome) * 100 : 0;
  const expenseVariancePercent =
    budgetedExpenses > 0 ? (expenseVariance / budgetedExpenses) * 100 : 0;

  return (
    <Card padding="lg" className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Monthly Overview</h3>
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          <Button
            variant={viewMode === "actual" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("actual")}
            className={cn(
              "text-xs px-3",
              viewMode !== "actual" && "text-gray-400 hover:text-white"
            )}
          >
            Actual
          </Button>
          <Button
            variant={viewMode === "budgeted" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("budgeted")}
            className={cn(
              "text-xs px-3",
              viewMode !== "budgeted" && "text-gray-400 hover:text-white"
            )}
          >
            Budgeted
          </Button>
          <Button
            variant={viewMode === "comparison" ? "primary" : "ghost"}
            size="sm"
            onClick={() => setViewMode("comparison")}
            className={cn(
              "text-xs px-3",
              viewMode !== "comparison" && "text-gray-400 hover:text-white"
            )}
          >
            Compare
          </Button>
        </div>
      </div>

      {/* Comparison View */}
      {viewMode === "comparison" && (
        <div className="space-y-4 mb-6">
          {/* Income Row */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm font-medium">Income</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  incomeVariance >= 0 ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                )}
              >
                {incomeVariance >= 0 ? "+" : ""}
                {incomeVariancePercent.toFixed(1)}% from budget
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Budgeted</p>
                <p className="text-xl font-semibold text-gray-400">
                  {formatCurrencyWithSign(budgetedIncome)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Actual/Projected</p>
                <p className="text-xl font-bold text-success">
                  {formatCurrencyWithSign(actualIncome)}
                </p>
              </div>
            </div>
          </div>

          {/* Expenses Row */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm font-medium">Expenses</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  expenseVariance <= 0 ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                )}
              >
                {expenseVariance >= 0 ? "+" : ""}
                {expenseVariancePercent.toFixed(1)}% from budget
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Budgeted</p>
                <p className="text-xl font-semibold text-gray-400">
                  -{formatCurrency(budgetedExpenses)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Actual/Projected</p>
                <p className="text-xl font-bold text-danger">-{formatCurrency(actualExpenses)}</p>
              </div>
            </div>
          </div>

          {/* Net Change Row */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm font-medium">Net Change</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  surplusVariance >= 0 ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
                )}
              >
                {formatCurrencyWithSign(surplusVariance)} vs budget
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Budgeted</p>
                <p
                  className={cn(
                    "text-xl font-semibold",
                    budgetedSurplus >= 0 ? "text-gray-400" : "text-gray-400"
                  )}
                >
                  {formatCurrencyWithSign(budgetedSurplus)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Actual/Projected</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    actualSurplus >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {formatCurrencyWithSign(actualSurplus)}
                </p>
              </div>
            </div>
          </div>

          {/* Savings Rate Row */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm font-medium">Savings Rate</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  savingsRateVariance >= 0
                    ? "bg-success/20 text-success"
                    : "bg-danger/20 text-danger"
                )}
              >
                {savingsRateVariance >= 0 ? "+" : ""}
                {savingsRateVariance.toFixed(1)}% vs budget
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Budgeted</p>
                <p className="text-xl font-semibold text-gray-400">
                  {budgetedSavingsRate.toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Actual/Projected</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    actualSavingsRate >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {actualSavingsRate.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Simple Actual View */}
      {viewMode === "actual" && (
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-gray-400 text-sm">Income</p>
            <p className="text-2xl font-bold text-success">
              {formatCurrencyWithSign(actualIncome)}
            </p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Expenses</p>
            <p className="text-2xl font-bold text-danger">-{formatCurrency(actualExpenses)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Net Change</p>
            <p
              className={cn(
                "text-2xl font-bold",
                actualSurplus >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatCurrencyWithSign(actualSurplus)}
            </p>
          </div>
        </div>
      )}

      {/* Simple Budgeted View */}
      {viewMode === "budgeted" && (
        <div className="grid grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-gray-400 text-sm">Expected Income</p>
            <p className="text-2xl font-bold text-success">
              {formatCurrencyWithSign(budgetedIncome)}
            </p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Expected Expenses</p>
            <p className="text-2xl font-bold text-danger">-{formatCurrency(budgetedExpenses)}</p>
          </div>
          <div>
            <p className="text-gray-400 text-sm">Expected Net</p>
            <p
              className={cn(
                "text-2xl font-bold",
                budgetedSurplus >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatCurrencyWithSign(budgetedSurplus)}
            </p>
          </div>
        </div>
      )}

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

      {actualSavingsRate < 0 && (
        <Alert variant="error" icon={<Icon name="trending_down" />} title="Negative Cash Flow">
          <p className="text-sm">
            Your expenses exceed your income this month. Consider reducing expenses or finding
            additional income sources.
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
                    {formatCurrency(cat.total)}
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
