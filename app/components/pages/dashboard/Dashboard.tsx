"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Button, Icon, LoadingSpinner, DateRangePicker } from "@/components/common";
import { useModal } from "@/components/modals";
import UpcomingActivityWidget from "./components/UpcomingActivityWidget";
import RecurringSummaryWidget from "./components/RecurringSummaryWidget";
import ProjectedVsActualWidget from "./components/ProjectedVsActualWidget";
import { collectOpenItems, getCategoryBreakdown } from "@/lib/logic/balanceCalculator";
import { getTodayKey } from "@/lib/utils/dateUtils";
import { calculateHealthScore, sampleDayOffsets, summarizePeriod } from "@/lib/logic/healthScore";
import dayjs from "dayjs";
import { CHART_COLORS, DASHBOARD_PRESETS } from "./constants";
import KPICards from "./components/KPICards";
import CashFlowChart from "./components/CashFlowChart";
import CategoryPieChart from "./components/CategoryPieChart";
import OverdueAlert from "./components/OverdueAlert";
import IncomeExpenseChart from "./components/IncomeExpenseChart";
import PeriodComparison from "./components/PeriodComparison";
import FinancialHealthScore from "./components/FinancialHealthScore";

const Dashboard: React.FC = () => {
  const router = useRouter();
  const { openModal } = useModal();
  const { userProfile, transactions, dailyBalances, isLoading, setViewDateRange } = useFinancial();

  // Date range state - Default to current month
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().startOf("month"),
    dayjs().endOf("month"),
  ]);

  // Derived date strings for logic functions
  const dateRangeStr = useMemo(() => {
    return {
      start: dateRange[0]?.format("YYYY-MM-DD") || getTodayKey(),
      end: dateRange[1]?.format("YYYY-MM-DD") || getTodayKey(),
    };
  }, [dateRange]);

  // Update view date range when user selects dates (expands if needed for projections)
  useEffect(() => {
    if (dateRange[0] && dateRange[1]) {
      setViewDateRange(dateRange[0].format("YYYY-MM-DD"), dateRange[1].format("YYYY-MM-DD"));
    }
  }, [dateRange, setViewDateRange]);

  // Calculate stats for selected period: the one definition shared with the Calendar, Forecast and
  // the managers (healthScore/periodStats.ts), so the same month prints the same numbers everywhere.
  const periodStats = useMemo(
    () => summarizePeriod(transactions, dateRangeStr.start, dateRangeStr.end),
    [transactions, dateRangeStr]
  );

  // Cash flow chart data - filtered by date range
  const chartData = useMemo(() => {
    const data: {
      date: string;
      day: number;
      opening: number;
      balance: number;
      label: string;
    }[] = [];

    // Iterate through each day in the range
    if (dateRange[0] && dateRange[1]) {
      const start = dateRange[0].startOf("day");
      const end = dateRange[1].startOf("day");

      // Sample long ranges down to about 90 points to keep the chart light, but ALWAYS keep the
      // last day: the closing balance is the end of the range, not the last sampled day.
      const daysDiff = end.diff(start, "day");

      sampleDayOffsets(daysDiff).forEach((offset) => {
        const current = start.add(offset, "day");
        const dateKey = current.format("YYYY-MM-DD");
        const dayBalance = dailyBalances.get(dateKey);
        // No balance for a day (outside the projected window): leave it out instead of drawing
        // today's balance there, which would look like a plausible flat line.
        if (!dayBalance) return;

        data.push({
          date: dateKey,
          day: current.date(),
          opening: dayBalance.openingBalance,
          balance: dayBalance.closingBalance,
          label: current.format(daysDiff > 31 ? "MMM D" : "D"),
        });
      });
    }

    return data;
  }, [dailyBalances, dateRange]);

  // Category breakdown - filtered by date range (with "Other" aggregation)
  const { expenseCategoryData, incomeCategoryData } = useMemo(() => {
    const { start, end } = dateRangeStr;
    // Filter transactions first
    const filteredTxns = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= start && date <= end;
    });

    // Helper to process breakdown with "Other" aggregation
    const processBreakdown = (type: "income" | "expense") => {
      const breakdown = getCategoryBreakdown(filteredTxns, type);
      const top5 = breakdown.slice(0, 5);
      const otherTotal = breakdown.slice(5).reduce((sum, item) => sum + item.total, 0);

      const result = top5.map((item, index) => ({
        name: item.category,
        value: item.total,
        color: CHART_COLORS[index % CHART_COLORS.length],
      }));

      if (otherTotal > 0) {
        result.push({
          name: "Other",
          value: otherTotal,
          color: CHART_COLORS[5],
        });
      }

      return result;
    };

    return {
      expenseCategoryData: processBreakdown("expense"),
      incomeCategoryData: processBreakdown("income"),
    };
  }, [transactions, dateRangeStr]);

  // Financial health score
  const healthScore = useMemo(() => {
    return calculateHealthScore(
      userProfile?.currentBalance || 0,
      transactions,
      dailyBalances,
      dateRangeStr.start,
      dateRangeStr.end
    );
  }, [userProfile, transactions, dailyBalances, dateRangeStr]);

  // Overdue transactions
  const overdueTransactions = useMemo(
    // Same definition as the risk views (balanceCalculator/openItems.ts): still projected, dated
    // before today, tracked back to the start of the default window.
    () => collectOpenItems(transactions, getTodayKey()).overdue,
    [transactions]
  );

  const openTransactionModal = useCallback(
    (transaction: Transaction) => {
      openModal("TransactionModal", { transaction });
    },
    [openModal]
  );

  if (isLoading) {
    return (
      <div className="p-4 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    );
  }

  const currentBalance = userProfile?.currentBalance || 0;

  return (
    <div className="p-4 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Dashboard</h1>
          <p className="text-gray-400 text-sm">
            Financial overview for {dateRange[0]?.format("MMM D")} -{" "}
            {dateRange[1]?.format("MMM D, YYYY")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
          <DateRangePicker
            value={dateRange as any} // Cast for dayjs compatibility
            onChange={(dates) => setDateRange(dates as any)}
            presets={DASHBOARD_PRESETS.map((p) => ({
              ...p,
              range: p.range as any,
            }))}
            className="w-full sm:w-[300px]"
          />

          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              variant="secondary"
              className="bg-success/20 text-success hover:bg-success/30 flex-1 sm:flex-none"
              icon={<Icon name="add" />}
              iconPosition="left"
              onClick={() => router.push("/income")}
            >
              Income
            </Button>
            <Button
              variant="danger"
              icon={<Icon name="remove" />}
              iconPosition="left"
              className="flex-1 sm:flex-none"
              onClick={() => router.push("/expenses")}
            >
              Expense
            </Button>
          </div>
        </div>
      </div>

      {/* KPI Cards - 2 column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 mb-6 lg:mb-8">
        <KPICards currentBalance={currentBalance} stats={periodStats} />
        <FinancialHealthScore healthScore={healthScore} />
      </div>

      {/* Alerts */}
      <OverdueAlert overdueTransactions={overdueTransactions} onReview={openTransactionModal} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8 mb-6 lg:mb-8">
        {/* Cash Flow Chart */}
        <CashFlowChart data={chartData} />

        {/* Period Comparison */}
        <PeriodComparison transactions={transactions} dateRange={dateRangeStr} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8 mb-6 lg:mb-8">
        {/* Income vs Expense Chart */}
        <IncomeExpenseChart transactions={transactions} dateRange={dateRangeStr} />

        {/* Category Breakdown */}
        <CategoryPieChart
          expenseData={expenseCategoryData}
          incomeData={incomeCategoryData}
          totalExpenses={periodStats.expenses}
          totalIncome={periodStats.income}
        />
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-8 mb-6 lg:mb-8">
        {/* Upcoming Activity Widget */}
        <div className="lg:col-span-2">
          <UpcomingActivityWidget onTransactionClick={openTransactionModal} />
        </div>

        {/* Side Widgets */}
        <div className="space-y-8">
          <RecurringSummaryWidget />
          <ProjectedVsActualWidget dateRange={dateRangeStr} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
