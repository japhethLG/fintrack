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
import { getCategoryBreakdown } from "@/lib/logic/balanceCalculator";
import { formatDate } from "@/lib/utils/dateUtils";
import { calculateHealthScore } from "@/lib/logic/healthScore";
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
  const {
    userProfile,
    transactions,
    dailyBalances,
    isLoading,
    markTransactionComplete,
    markTransactionSkipped,
    setViewDateRange,
  } = useFinancial();

  // Date range state - Default to current month
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null]>([
    dayjs().startOf("month"),
    dayjs().endOf("month"),
  ]);

  // Derived date strings for logic functions
  const dateRangeStr = useMemo(() => {
    return {
      start: dateRange[0]?.format("YYYY-MM-DD") || formatDate(new Date()),
      end: dateRange[1]?.format("YYYY-MM-DD") || formatDate(new Date()),
    };
  }, [dateRange]);

  // Update view date range when user selects dates (expands if needed for projections)
  useEffect(() => {
    if (dateRange[0] && dateRange[1]) {
      setViewDateRange(dateRange[0].format("YYYY-MM-DD"), dateRange[1].format("YYYY-MM-DD"));
    }
  }, [dateRange, setViewDateRange]);

  // Calculate stats for selected period
  const periodStats = useMemo(() => {
    const { start, end } = dateRangeStr;

    let income = 0;
    let expenses = 0;
    let completedIncomeCount = 0;
    let pendingIncomeCount = 0;
    let skippedIncomeCount = 0;
    let completedExpenseCount = 0;
    let pendingExpenseCount = 0;
    let skippedExpenseCount = 0;

    transactions.forEach((t) => {
      const date = t.actualDate || t.scheduledDate;
      if (date >= start && date <= end) {
        const isPending = t.status === "projected";
        const isCompleted = t.status === "completed";
        const isSkipped = t.status === "skipped";

        if (t.type === "income") {
          if (isCompleted) completedIncomeCount++;
          if (isPending) pendingIncomeCount++;
          if (isSkipped) skippedIncomeCount++;
          // Only add to totals if not skipped
          if (!isSkipped) {
            income += t.actualAmount ?? t.projectedAmount;
          }
        } else {
          if (isCompleted) completedExpenseCount++;
          if (isPending) pendingExpenseCount++;
          if (isSkipped) skippedExpenseCount++;
          // Only add to totals if not skipped
          if (!isSkipped) {
            expenses += t.actualAmount ?? t.projectedAmount;
          }
        }
      }
    });

    return {
      income,
      expenses,
      net: income - expenses,
      completedIncomeCount,
      pendingIncomeCount,
      skippedIncomeCount,
      completedExpenseCount,
      pendingExpenseCount,
      skippedExpenseCount,
    };
  }, [transactions, dateRangeStr]);

  // Cash flow chart data - filtered by date range
  const chartData = useMemo(() => {
    const data: { date: string; day: number; balance: number; label: string }[] = [];

    // Iterate through each day in the range
    if (dateRange[0] && dateRange[1]) {
      let current = dateRange[0].clone();
      const end = dateRange[1];

      // Limit to 90 days to prevent performance issues with large ranges
      const daysDiff = end.diff(current, "day");
      const step = daysDiff > 90 ? Math.ceil(daysDiff / 90) : 1;

      while (current.isBefore(end) || current.isSame(end, "day")) {
        const dateKey = current.format("YYYY-MM-DD");
        const dayBalance = dailyBalances.get(dateKey);

        data.push({
          date: dateKey,
          day: current.date(),
          balance: dayBalance?.closingBalance ?? (userProfile?.currentBalance || 0),
          label: current.format(daysDiff > 31 ? "MMM D" : "D"),
        });

        current = current.add(step, "day");
      }
    }

    return data;
  }, [dailyBalances, userProfile, dateRange]);

  // Category breakdown - filtered by date range
  const categoryData = useMemo(() => {
    const { start, end } = dateRangeStr;
    // Filter transactions first
    const filteredTxns = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= start && date <= end;
    });

    const breakdown = getCategoryBreakdown(filteredTxns, "expense");
    return breakdown.slice(0, 6).map((item, index) => ({
      name: item.category,
      value: item.total,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
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
  const overdueTransactions = useMemo(() => {
    const today = formatDate(new Date());
    return transactions.filter(
      (t) => t.scheduledDate < today && t.status !== "completed" && t.status !== "skipped"
    );
  }, [transactions]);

  const openTransactionModal = useCallback(
    (transaction: Transaction) => {
      openModal("CompleteTransactionModal", {
        transaction,
        onComplete: async (data: { actualAmount: number; actualDate?: string; notes?: string }) => {
          await markTransactionComplete(transaction.id, data);
        },
        onSkip: async (notes?: string) => {
          await markTransactionSkipped(transaction.id, notes);
        },
      });
    },
    [openModal, markTransactionComplete, markTransactionSkipped]
  );

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading dashboard..." />
      </div>
    );
  }

  const currentBalance = userProfile?.currentBalance || 0;

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
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

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <KPICards currentBalance={currentBalance} stats={periodStats} />
        <FinancialHealthScore healthScore={healthScore} />
      </div>

      {/* Alerts */}
      <OverdueAlert overdueTransactions={overdueTransactions} onReview={openTransactionModal} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Cash Flow Chart */}
        <CashFlowChart data={chartData} />

        {/* Period Comparison */}
        <PeriodComparison transactions={transactions} dateRange={dateRangeStr} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Income vs Expense Chart */}
        <IncomeExpenseChart transactions={transactions} dateRange={dateRangeStr} />

        {/* Category Breakdown */}
        <CategoryPieChart data={categoryData} totalExpenses={periodStats.expenses} />
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
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
