"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { analyzeBudget, AnalysisContext } from "@/lib/services/geminiService";
import {
  getRunway,
  getNextCrunch,
  calculateVarianceReport,
  getCategoryBreakdown,
} from "@/lib/logic/balanceCalculator";
import { LoadingSpinner, Icon } from "@/components/common";
import MetricsGrid from "./components/MetricsGrid";
import MonthlyOverview from "./components/MonthlyOverview";
import AIAnalysisPanel from "./components/AIAnalysisPanel";

const Forecast: React.FC = () => {
  const { userProfile, transactions, incomeSources, expenseRules, billCoverage, isLoading } =
    useFinancial();

  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Get current month date range
  const dateRange = useMemo(() => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString()
      .split("T")[0];
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0)
      .toISOString()
      .split("T")[0];
    return { start: startOfMonth, end: endOfMonth };
  }, []);

  // Calculate ACTUAL metrics from transactions (same logic as dashboard)
  const actualMetrics = useMemo(() => {
    const { start, end } = dateRange;

    let income = 0;
    let expenses = 0;

    transactions.forEach((t) => {
      const date = t.actualDate || t.scheduledDate;
      if (date >= start && date <= end) {
        // Skip skipped transactions
        if (t.status === "skipped") return;

        const amount = t.actualAmount ?? t.projectedAmount;

        if (t.type === "income") {
          income += amount;
        } else {
          expenses += amount;
        }
      }
    });

    const surplus = income - expenses;
    const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;

    return {
      monthlyIncome: income,
      monthlyExpenses: expenses,
      monthlySurplus: surplus,
      savingsRate,
    };
  }, [transactions, dateRange]);

  // Calculate BUDGETED metrics from income sources and expense rules
  const budgetedMetrics = useMemo(() => {
    const activeIncome = incomeSources.filter((s) => s.isActive);
    const activeExpenses = expenseRules.filter((r) => r.isActive);

    let monthlyIncome = 0;
    activeIncome.forEach((s) => {
      let monthly = s.amount;
      switch (s.frequency) {
        case "weekly":
          monthly *= 4.33; // More accurate weeks per month
          break;
        case "bi-weekly":
          monthly *= 2.17; // More accurate bi-weekly per month
          break;
        case "semi-monthly":
          monthly *= s.scheduleConfig.specificDays?.length || 2;
          break;
        case "quarterly":
          monthly /= 3;
          break;
        case "yearly":
          monthly /= 12;
          break;
      }
      monthlyIncome += monthly;
    });

    let monthlyExpenses = 0;
    activeExpenses.forEach((r) => {
      let monthly = r.amount;
      switch (r.frequency) {
        case "weekly":
          monthly *= 4.33;
          break;
        case "bi-weekly":
          monthly *= 2.17;
          break;
        case "semi-monthly":
          monthly *= r.scheduleConfig.specificDays?.length || 2;
          break;
        case "quarterly":
          monthly /= 3;
          break;
        case "yearly":
          monthly /= 12;
          break;
      }
      monthlyExpenses += monthly;
    });

    const savingsRate =
      monthlyIncome > 0 ? ((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100 : 0;

    return {
      monthlyIncome,
      monthlyExpenses,
      monthlySurplus: monthlyIncome - monthlyExpenses,
      savingsRate,
    };
  }, [incomeSources, expenseRules]);

  // Calculate financial metrics for MetricsGrid
  const metrics = useMemo(() => {
    if (!userProfile) return null;

    const balance = userProfile.currentBalance;
    const runway = getRunway(balance, transactions);
    const nextCrunch = getNextCrunch(balance, transactions);

    const variance = calculateVarianceReport(transactions, dateRange.start, dateRange.end);

    // Category breakdown from actual transactions
    const filteredTxns = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= dateRange.start && date <= dateRange.end;
    });
    const categoryBreakdown = getCategoryBreakdown(filteredTxns, "expense");

    // Debt total
    const activeExpenses = expenseRules.filter((r) => r.isActive);
    let totalDebt = 0;
    activeExpenses.forEach((r) => {
      if (r.loanConfig) totalDebt += r.loanConfig.currentBalance;
      if (r.creditConfig) totalDebt += r.creditConfig.currentBalance;
    });

    return {
      balance,
      runway,
      nextCrunch,
      variance,
      categoryBreakdown,
      // Use actual metrics for display
      monthlyIncome: actualMetrics.monthlyIncome,
      monthlyExpenses: actualMetrics.monthlyExpenses,
      monthlySurplus: actualMetrics.monthlySurplus,
      savingsRate: actualMetrics.savingsRate,
      totalDebt,
      billsAtRisk: billCoverage?.upcomingBills.filter((b) => !b.canCover).length || 0,
    };
  }, [userProfile, transactions, expenseRules, billCoverage, dateRange, actualMetrics]);

  const handleAnalyze = async () => {
    if (!userProfile) return;

    setAnalyzing(true);
    try {
      const context: AnalysisContext = {
        transactions,
        incomeSources,
        expenseRules,
        currentBalance: userProfile.currentBalance,
        billCoverage: billCoverage || undefined,
      };

      const result = await analyzeBudget(context);
      setAnalysis(result);
    } catch (error) {
      console.error("Failed to analyze budget:", error);
      setAnalysis("Error: Unable to generate analysis. Please check your API configuration.");
    } finally {
      setAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading forecast data..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
          <Icon name="smart_toy" size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">AI Financial Forecaster</h1>
        <p className="text-gray-400 max-w-lg mx-auto">
          Get intelligent insights about your financial health, spending patterns, and personalized
          recommendations.
        </p>
      </div>

      {/* Quick Metrics */}
      {metrics && (
        <MetricsGrid
          metrics={metrics}
          budgetedMetrics={budgetedMetrics}
          actualMetrics={actualMetrics}
        />
      )}

      {/* Financial Summary */}
      {metrics && (
        <MonthlyOverview
          actualIncome={actualMetrics.monthlyIncome}
          actualExpenses={actualMetrics.monthlyExpenses}
          actualSurplus={actualMetrics.monthlySurplus}
          actualSavingsRate={actualMetrics.savingsRate}
          budgetedIncome={budgetedMetrics.monthlyIncome}
          budgetedExpenses={budgetedMetrics.monthlyExpenses}
          budgetedSurplus={budgetedMetrics.monthlySurplus}
          budgetedSavingsRate={budgetedMetrics.savingsRate}
          billsAtRisk={metrics.billsAtRisk}
          categoryBreakdown={metrics.categoryBreakdown}
        />
      )}

      {/* AI Analysis */}
      <AIAnalysisPanel
        analysis={analysis}
        analyzing={analyzing}
        transactionCount={transactions.length}
        incomeSourceCount={incomeSources.length}
        expenseRuleCount={expenseRules.length}
        onAnalyze={handleAnalyze}
        onClear={() => setAnalysis(null)}
      />
    </div>
  );
};

export default Forecast;
