"use client";

import React, { useState, useMemo, useEffect } from "react";
import dayjs from "dayjs";
import { useFinancial } from "@/contexts/FinancialContext";
import {
  analyzeBudget,
  AnalysisContext,
  fetchAvailableModels,
  GeminiModel,
  DEFAULT_MODEL,
} from "@/lib/services/geminiService";
import {
  needsApiKeyConfiguration,
  isProduction,
  getEffectiveApiKey,
} from "@/lib/services/apiKeyService";
import { useModal } from "@/components/modals";
import {
  getRunway,
  getNextCrunch,
  calculateVarianceReport,
  getCategoryBreakdown,
} from "@/lib/logic/balanceCalculator";
import { savingsRatePercent, summarizePeriod } from "@/lib/logic/healthScore";
import { plannedTotals, totalDebt } from "@/lib/logic/forecasting";
import { useCurrency } from "@/lib/hooks/useCurrency";
import {
  LoadingSpinner,
  Icon,
  DateRangePicker,
  Button,
  Tooltip,
  Select,
} from "@/components/common";
import MetricsGrid from "./components/MetricsGrid";
import MonthlyOverview from "./components/MonthlyOverview";
import AIAnalysisPanel from "./components/AIAnalysisPanel";

// Forecast-specific date range presets. "Next N days" is N calendar days, today included
// (today + N - 1; see `lastDayOfNextDays`).
const FORECAST_PRESETS = [
  {
    value: "this-month",
    label: "This Month",
    range: [dayjs().startOf("month"), dayjs().endOf("month")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-30",
    label: "Next 30 Days",
    range: [dayjs(), dayjs().add(29, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-60",
    label: "Next 60 Days",
    range: [dayjs(), dayjs().add(59, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
  },
  {
    value: "next-90",
    label: "Next 90 Days",
    range: [dayjs(), dayjs().add(89, "day")] as [dayjs.Dayjs, dayjs.Dayjs],
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

  // Model picker state
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL);
  const [availableModels, setAvailableModels] = useState<GeminiModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Check API key status on mount and after modal closes
  useEffect(() => {
    setApiKeyMissing(needsApiKeyConfiguration());
  }, []);

  // Fetch available models when API key is available
  useEffect(() => {
    const loadModels = async () => {
      const apiKey = getEffectiveApiKey();
      if (!apiKey) {
        setAvailableModels([]);
        return;
      }

      setLoadingModels(true);
      try {
        const models = await fetchAvailableModels();
        setAvailableModels(models);
        // If current selection isn't in the list, reset to default
        if (models.length > 0 && !models.find((m) => m.name === selectedModel)) {
          const defaultExists = models.find((m) => m.name === DEFAULT_MODEL);
          setSelectedModel(defaultExists ? DEFAULT_MODEL : models[0].name);
        }
      } catch (error) {
        console.error("Failed to load models:", error);
        setAvailableModels([]);
      } finally {
        setLoadingModels(false);
      }
    };

    loadModels();
  }, [apiKeyMissing]); // Re-fetch when API key status changes

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

  // Calculate ACTUAL metrics from transactions: the same definition the Dashboard and the Calendar
  // use (healthScore/periodStats.ts), so a period prints the same income, expenses and net.
  const actualMetrics = useMemo(() => {
    const period = summarizePeriod(transactions, dateRangeStr.start, dateRangeStr.end);

    return {
      monthlyIncome: period.income,
      monthlyExpenses: period.expenses,
      monthlySurplus: period.net,
      savingsRate: savingsRatePercent(period.income, period.expenses),
    };
  }, [transactions, dateRangeStr]);

  // BUDGETED metrics are the PLAN of the selected period: every non-skipped row scheduled in it at
  // its projected amount (the same plan the Projected vs Actual widget shows). Counted from the
  // occurrences, never estimated as amount x multiplier x days/30, so a 3,000 salary is a 3,000
  // budget in a 31-day month and a plan that is met exactly shows no variance.
  const budgetedMetrics = useMemo(() => {
    const plan = plannedTotals(transactions, dateRangeStr.start, dateRangeStr.end);

    return {
      monthlyIncome: plan.income,
      monthlyExpenses: plan.expenses,
      monthlySurplus: plan.net,
      savingsRate: savingsRatePercent(plan.income, plan.expenses),
    };
  }, [transactions, dateRangeStr]);

  // Calculate financial metrics for MetricsGrid
  const metrics = useMemo(() => {
    if (!userProfile) return null;

    const balance = userProfile.currentBalance;
    // One walk, one horizon: the same first negative day as the health score's runway
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
    // Loans, cards AND installment plans (the Expenses page counts them all as debt)
    const periodDebt = totalDebt(activeExpenses);

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
      totalDebt: periodDebt,
      hasData: transactions.length > 0,
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

      const result = await analyzeBudget(context, selectedModel);
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
      <div className="p-4 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading forecast data..." />
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-10 max-w-5xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6 lg:mb-8">
        <div className="text-left">
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

        <div className="flex flex-wrap items-center gap-2 lg:gap-3 w-full lg:w-auto">
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

          {/* Model Picker */}
          <Tooltip
            content={
              availableModels.find((m) => m.name === selectedModel)?.description ||
              "Select AI model"
            }
            position="bottom"
          >
            <div className="w-full lg:w-[200px]">
              <Select
                value={selectedModel}
                onChange={setSelectedModel}
                options={
                  loadingModels
                    ? [{ value: selectedModel, label: "Loading models..." }]
                    : availableModels.length > 0
                      ? availableModels.map((m) => ({
                          value: m.name,
                          label: m.displayName,
                        }))
                      : [{ value: DEFAULT_MODEL, label: "Gemini 2.5 Flash" }]
                }
                placeholder="Select model"
                disabled={loadingModels || apiKeyMissing}
              />
            </div>
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
