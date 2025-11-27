"use client";

import React from "react";
import { Card, Icon } from "@/components/common";
import { cn } from "@/lib/utils/cn";
import { useCurrency } from "@/lib/hooks/useCurrency";
import InsightCard from "./InsightCard";

interface Metrics {
  balance: number;
  runway: {
    runOutDate: string | null;
    days: number;
  };
  nextCrunch: {
    date: string;
    shortfall: number;
  } | null;
  savingsRate: number;
  monthlySurplus: number;
  totalDebt: number;
}

interface MonthlyMetrics {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySurplus: number;
  savingsRate: number;
}

interface IProps {
  metrics: Metrics;
  budgetedMetrics: MonthlyMetrics;
  actualMetrics: MonthlyMetrics;
}

const MetricsGrid: React.FC<IProps> = ({ metrics, budgetedMetrics, actualMetrics }) => {
  const { formatCurrency } = useCurrency();

  // Calculate variance percentages
  const incomeVariance =
    budgetedMetrics.monthlyIncome > 0
      ? ((actualMetrics.monthlyIncome - budgetedMetrics.monthlyIncome) /
          budgetedMetrics.monthlyIncome) *
        100
      : 0;

  const expenseVariance =
    budgetedMetrics.monthlyExpenses > 0
      ? ((actualMetrics.monthlyExpenses - budgetedMetrics.monthlyExpenses) /
          budgetedMetrics.monthlyExpenses) *
        100
      : 0;

  return (
    <div className="space-y-6 mb-8">
      {/* Primary Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InsightCard
          icon="account_balance_wallet"
          title="Current Balance"
          value={formatCurrency(metrics.balance)}
          status={metrics.balance >= 0 ? "success" : "danger"}
        />
        <InsightCard
          icon="timeline"
          title="Cash Runway"
          value={metrics.runway.runOutDate ? `${metrics.runway.days} days` : "90+ days"}
          subtitle={
            metrics.nextCrunch
              ? `Crunch on ${new Date(metrics.nextCrunch.date).toLocaleDateString()}`
              : "No crunch detected"
          }
          status={metrics.runway.runOutDate ? "warning" : "success"}
        />
        <InsightCard
          icon="savings"
          title="Actual Savings Rate"
          value={`${actualMetrics.savingsRate.toFixed(1)}%`}
          subtitle={`${formatCurrency(actualMetrics.monthlySurplus)} this month`}
          status={
            actualMetrics.savingsRate >= 20
              ? "success"
              : actualMetrics.savingsRate >= 0
                ? "warning"
                : "danger"
          }
        />
        <InsightCard
          icon="credit_card"
          title="Total Debt"
          value={formatCurrency(metrics.totalDebt)}
          status={metrics.totalDebt > 0 ? "warning" : "success"}
        />
      </div>

      {/* Budgeted vs Actual Comparison */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="compare_arrows" className="text-primary" />
          <h3 className="text-sm font-semibold text-white">Budgeted vs Actual (This Month)</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Income Comparison */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Income</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  incomeVariance >= 0
                    ? "bg-success/20 text-success"
                    : "bg-danger/20 text-danger"
                )}
              >
                {incomeVariance >= 0 ? "+" : ""}
                {incomeVariance.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-gray-500">Budgeted</p>
                <p className="text-lg font-semibold text-gray-400">
                  {formatCurrency(budgetedMetrics.monthlyIncome)}
                </p>
              </div>
              <Icon name="arrow_forward" size="sm" className="text-gray-600 mb-2" />
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-lg font-bold text-success">
                  {formatCurrency(actualMetrics.monthlyIncome)}
                </p>
              </div>
            </div>
          </div>

          {/* Expenses Comparison */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Expenses</span>
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full",
                  expenseVariance <= 0
                    ? "bg-success/20 text-success"
                    : "bg-danger/20 text-danger"
                )}
              >
                {expenseVariance >= 0 ? "+" : ""}
                {expenseVariance.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-gray-500">Budgeted</p>
                <p className="text-lg font-semibold text-gray-400">
                  {formatCurrency(budgetedMetrics.monthlyExpenses)}
                </p>
              </div>
              <Icon name="arrow_forward" size="sm" className="text-gray-600 mb-2" />
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p className="text-lg font-bold text-danger">
                  {formatCurrency(actualMetrics.monthlyExpenses)}
                </p>
              </div>
            </div>
          </div>

          {/* Net Comparison */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Net Change</span>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-gray-500">Budgeted</p>
                <p
                  className={cn(
                    "text-lg font-semibold",
                    budgetedMetrics.monthlySurplus >= 0 ? "text-gray-400" : "text-gray-400"
                  )}
                >
                  {formatCurrency(budgetedMetrics.monthlySurplus)}
                </p>
              </div>
              <Icon name="arrow_forward" size="sm" className="text-gray-600 mb-2" />
              <div className="text-right">
                <p className="text-xs text-gray-500">Actual</p>
                <p
                  className={cn(
                    "text-lg font-bold",
                    actualMetrics.monthlySurplus >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {formatCurrency(actualMetrics.monthlySurplus)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default MetricsGrid;
