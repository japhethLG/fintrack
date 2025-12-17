"use client";

import React, { useState, useMemo, useEffect } from "react";
import dayjs from "dayjs";
import { useFinancial } from "@/contexts/FinancialContext";
import { analyzeBudget, AnalysisContext } from "@/lib/services/geminiService";
import { needsApiKeyConfiguration, isProduction } from "@/lib/services/apiKeyService";
import { useModal } from "@/components/modals";
import {
  getRunway,
  getNextCrunch,
  calculateVarianceReport,
  getCategoryBreakdown,
} from "@/lib/logic/balanceCalculator";
import { getMonthlyMultiplier, prorateToDateRange } from "@/lib/utils/frequencyUtils";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { LoadingSpinner, Icon, DateRangePicker, Button, Tooltip } from "@/components/common";
import MetricsGrid from "./components/MetricsGrid";
import MonthlyOverview from "./components/MonthlyOverview";
import AIAnalysisPanel from "./components/AIAnalysisPanel";

// Forecast-specific date range presets
const FORECAST_PRESETS = [
  {
    value: "this-month",
    label: "This Month",
    range: [dayjs().startOf("month"), dayjs().endOf("month")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-30",
    label: "Next 30 Days",
    range: [dayjs(), dayjs().add(30, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-60",
    label: "Next 60 Days",
    range: [dayjs(), dayjs().add(60, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-90",
    label: "Next 90 Days",
    range: [dayjs(), dayjs().add(90, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "this-quarter",
    label: "This Quarter",
    range: [dayjs().startOf("quarter"), dayjs().endOf("quarter")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
];

const Forecast: React.FC = () => {
  const {
    userProfile,
    transactions,
    incomeSources,
    expenseRules,
    billCoverage,
    isLoading,
    setViewDateRange,
  } = useFinancial();
  const { currencySymbol } = useCurrency();
  const { openModal } = useModal();

  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  // Check API key status on mount and after modal closes
  useEffect(() => {
    setApiKeyMissing(needsApiKeyConfiguration());
  }, []);

  const handleOpenApiKeyModal = () => {
    openModal("ApiKeyModal", {
      onSave: () => {
        setApiKeyMissing(needsApiKeyConfiguration());
      },
    });
  };

  // Date range state - Default to current month
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().startOf("month"),
    dayjs().endOf("month"),
  ]);

  // Derived date strings for logic functions
  const dateRangeStr = useMemo(
    () => ({
      start: dateRange[0]?.format("YYYY-MM-DD") || dayjs().startOf("month").format("YYYY-MM-DD"),
      end: dateRange[1]?.format("YYYY-MM-DD") || dayjs().endOf("month").format("YYYY-MM-DD"),
    }),
    [dateRange]
  );

  // Update view date range when user selects dates (expands if needed for projections)
  useEffect(() => {
    if (dateRange[0] && dateRange[1]) {
      setViewDateRange(dateRange[0].format("YYYY-MM-DD"), dateRange[1].format("YYYY-MM-DD"));
    }
  }, [dateRange, setViewDateRange]);

  // Get period label for display
  const periodLabel = useMemo(() => {
    if (!dateRange[0] || !dateRange[1]) return "Selected Period";
    const start = dateRange[0];
    const end = dateRange[1];
    const daysDiff = end.diff(start, "day") + 1;

    if (
      daysDiff <= 31 &&
      start.isSame(start.startOf("month"), "day") &&
      end.isSame(end.endOf("month"), "day")
    ) {
      return start.format("MMMM YYYY");
    }
    return `${start.format("MMM D")} - ${end.format("MMM D, YYYY")}`;
  }, [dateRange]);

  // Calculate ACTUAL metrics from transactions (same logic as dashboard)
  const actualMetrics = useMemo(() => {
    const { start, end } = dateRangeStr;

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
  }, [transactions, dateRangeStr]);

  // Calculate BUDGETED metrics from income sources and expense rules
  // Prorated to match the selected date range
  // Only includes sources/rules that are active within the selected period
  const budgetedMetrics = useMemo(() => {
    const { start, end } = dateRangeStr;

    // Helper to check if a source/rule overlaps with the selected date range
    const isWithinDateRange = (sourceStart: string, sourceEnd?: string): boolean => {
      // Source starts after the selected range ends
      if (sourceStart > end) return false;
      // Source ends before the selected range starts
      if (sourceEnd && sourceEnd < start) return false;
      return true;
    };

    // Filter to active AND within date range
    const activeIncome = incomeSources.filter(
      (s) => s.isActive && isWithinDateRange(s.startDate, s.endDate)
    );
    const activeExpenses = expenseRules.filter(
      (r) => r.isActive && isWithinDateRange(r.startDate, r.endDate)
    );

    // Calculate monthly equivalent first
    let monthlyIncome = 0;
    activeIncome.forEach((s) => {
      if (s.frequency === "one-time") return; // Skip one-time for recurring projections
      const multiplier = getMonthlyMultiplier(s.frequency);
      monthlyIncome += s.amount * multiplier;
    });

    let monthlyExpenses = 0;
    activeExpenses.forEach((r) => {
      if (r.frequency === "one-time") return; // Skip one-time for recurring projections

      // Handle credit card payment strategies
      let amount = r.amount;
      if (r.creditConfig) {
        if (r.creditConfig.paymentStrategy === "fixed" && r.creditConfig.fixedPaymentAmount) {
          amount = r.creditConfig.fixedPaymentAmount;
        } else if (r.creditConfig.paymentStrategy === "full_balance") {
          amount = r.creditConfig.currentBalance;
        }
      }

      const multiplier = getMonthlyMultiplier(r.frequency);
      monthlyExpenses += amount * multiplier;
    });

    // Prorate to selected date range
    const proratedIncome = prorateToDateRange(monthlyIncome, start, end);
    const proratedExpenses = prorateToDateRange(monthlyExpenses, start, end);
    const surplus = proratedIncome - proratedExpenses;
    const savingsRate = proratedIncome > 0 ? (surplus / proratedIncome) * 100 : 0;

    return {
      monthlyIncome: proratedIncome,
      monthlyExpenses: proratedExpenses,
      monthlySurplus: surplus,
      savingsRate,
    };
  }, [incomeSources, expenseRules, dateRangeStr]);

  // Calculate financial metrics for MetricsGrid
  const metrics = useMemo(() => {
    if (!userProfile) return null;

    const balance = userProfile.currentBalance;
    const runway = getRunway(balance, transactions);
    const nextCrunch = getNextCrunch(balance, transactions);

    const variance = calculateVarianceReport(transactions, dateRangeStr.start, dateRangeStr.end);

    // Category breakdown from actual transactions
    const filteredTxns = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= dateRangeStr.start && date <= dateRangeStr.end;
    });
    const categoryBreakdown = getCategoryBreakdown(filteredTxns, "expense");

    // Debt total - only for loans/cards active within the selected period
    // Helper to check date overlap (same logic as budgetedMetrics)
    const isWithinPeriod = (ruleStart: string, ruleEnd?: string): boolean => {
      if (ruleStart > dateRangeStr.end) return false;
      if (ruleEnd && ruleEnd < dateRangeStr.start) return false;
      return true;
    };

    const activeExpenses = expenseRules.filter(
      (r) => r.isActive && isWithinPeriod(r.startDate, r.endDate)
    );
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
  }, [userProfile, transactions, expenseRules, billCoverage, dateRangeStr, actualMetrics]);

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
        currencySymbol,
        // Include pre-computed summary for the AI
        periodSummary: {
          dateRange: dateRangeStr,
          actualIncome: actualMetrics.monthlyIncome,
          actualExpenses: actualMetrics.monthlyExpenses,
          budgetedIncome: budgetedMetrics.monthlyIncome,
          budgetedExpenses: budgetedMetrics.monthlyExpenses,
          savingsRate: actualMetrics.savingsRate,
        },
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
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-8">
        <div className="text-center lg:text-left">
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Icon name="smart_toy" size={32} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">AI Financial Forecaster</h1>
              <p className="text-gray-400 text-sm">Insights for {periodLabel}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* API Key Config Button */}
          <Tooltip
            content={apiKeyMissing ? "API key required" : "Configure API key"}
            position="bottom"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenApiKeyModal}
              className={apiKeyMissing && isProduction() ? "text-warning" : ""}
            >
              <Icon
                name="key"
                size={20}
                className={apiKeyMissing && isProduction() ? "text-warning" : ""}
              />
            </Button>
          </Tooltip>

          {/* Date Range Picker */}
          <DateRangePicker
            value={dateRange as [dayjs.Dayjs | null, dayjs.Dayjs | null]}
            onChange={(dates) => setDateRange(dates as [dayjs.Dayjs | null, dayjs.Dayjs | null])}
            presets={FORECAST_PRESETS.map((p) => ({
              value: p.value,
              label: p.label,
              range: p.range as [dayjs.Dayjs, dayjs.Dayjs],
            }))}
            className="w-full lg:w-[300px]"
          />
        </div>
      </div>

      {/* Quick Metrics */}
      {metrics && (
        <MetricsGrid
          metrics={metrics}
          budgetedMetrics={budgetedMetrics}
          actualMetrics={actualMetrics}
          periodLabel={periodLabel}
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
          periodLabel={periodLabel}
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
