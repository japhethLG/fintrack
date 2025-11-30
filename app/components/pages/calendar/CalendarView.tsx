"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction, CompleteTransactionData } from "@/lib/types";
import { Button, Card, PageHeader, Icon, LoadingSpinner } from "@/components/common";
import { formatDate, isSameDay, startOfDay } from "@/lib/utils/dateUtils";
import { CompleteTransactionModal } from "@/components/pages/transactions";
import { WEEKDAYS } from "./constants";
import type { CalendarDay } from "./types";
import DayCell from "./components/DayCell";
import WeekDayCell from "./components/WeekDayCell";
import MonthSummary from "./components/MonthSummary";
import PeriodBalanceSummary from "./components/PeriodBalanceSummary";
import DayDetailSidebar from "./components/DayDetailSidebar";

const CalendarView: React.FC = () => {
  const {
    transactions,
    dailyBalances,
    isLoading,
    markTransactionComplete,
    markTransactionSkipped,
    markTransactionPartial,
    setViewDateRange,
  } = useFinancial();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // Calculate calendar days
  const calendarDays = useMemo((): CalendarDay[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: CalendarDay[] = [];
    const today = startOfDay(new Date());

    // Previous month days
    const prevMonth = new Date(year, month, 0);
    const prevMonthDays = prevMonth.getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthDays - i);
      const dateKey = formatDate(date);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        isPast: date < today,
        dayBalance: dailyBalances.get(dateKey) || null,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(year, month, i);
      const dateKey = formatDate(date);
      days.push({
        date,
        isCurrentMonth: true,
        isToday: isSameDay(date, today),
        isPast: date < today,
        dayBalance: dailyBalances.get(dateKey) || null,
      });
    }

    // Next month days to fill grid
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      const date = new Date(year, month + 1, i);
      const dateKey = formatDate(date);
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        isPast: false,
        dayBalance: dailyBalances.get(dateKey) || null,
      });
    }

    return days;
  }, [currentDate, dailyBalances]);

  // Calculate week days for week view
  const calendarWeekDays = useMemo((): CalendarDay[] => {
    const today = startOfDay(new Date());
    const days: CalendarDay[] = [];

    // Get the start of the week (Sunday) containing currentDate
    const current = new Date(currentDate);
    const dayOfWeek = current.getDay();
    const weekStart = new Date(current);
    weekStart.setDate(current.getDate() - dayOfWeek);

    // Generate 7 days
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      const dateKey = formatDate(date);
      days.push({
        date,
        isCurrentMonth: date.getMonth() === currentDate.getMonth(),
        isToday: isSameDay(date, today),
        isPast: date < today,
        dayBalance: dailyBalances.get(dateKey) || null,
      });
    }

    return days;
  }, [currentDate, dailyBalances]);

  // Week date range for header
  const weekDateRange = useMemo(() => {
    if (calendarWeekDays.length === 0) return "";
    const start = calendarWeekDays[0].date;
    const end = calendarWeekDays[6].date;
    const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const endStr = end.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${startStr} - ${endStr}`;
  }, [calendarWeekDays]);

  // Selected day details
  const selectedDayKey = selectedDate ? formatDate(selectedDate) : null;
  const selectedDayBalance = selectedDayKey ? dailyBalances.get(selectedDayKey) : null;
  const selectedDayTransactions = selectedDayBalance?.transactions || [];

  // Navigation
  const goToPrevMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    // Update view date range to include the new month (expands if needed)
    const monthStart = formatDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
    const monthEnd = formatDate(new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0));
    setViewDateRange(monthStart, monthEnd);
    setCurrentDate(newDate);
  };

  const goToNextMonth = () => {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    // Update view date range to include the new month (expands if needed)
    const monthStart = formatDate(new Date(newDate.getFullYear(), newDate.getMonth(), 1));
    const monthEnd = formatDate(new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0));
    setViewDateRange(monthStart, monthEnd);
    setCurrentDate(newDate);
  };

  // Week navigation
  const goToPrevWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() - 7);
    // Update view date range to include the new week (expands if needed)
    const dayOfWeek = newDate.getDay();
    const weekStart = new Date(newDate);
    weekStart.setDate(newDate.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    setViewDateRange(formatDate(weekStart), formatDate(weekEnd));
    setCurrentDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + 7);
    // Update view date range to include the new week (expands if needed)
    const dayOfWeek = newDate.getDay();
    const weekStart = new Date(newDate);
    weekStart.setDate(newDate.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    setViewDateRange(formatDate(weekStart), formatDate(weekEnd));
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  // Transaction handlers
  const handleComplete = async (data: CompleteTransactionData) => {
    if (!selectedTransaction) return;
    await markTransactionComplete(selectedTransaction.id, data);
    setSelectedTransaction(null);
  };

  const handleSkip = async (notes?: string) => {
    if (!selectedTransaction) return;
    await markTransactionSkipped(selectedTransaction.id, notes);
    setSelectedTransaction(null);
  };

  const handlePartial = async (amount: number, notes?: string) => {
    if (!selectedTransaction) return;
    await markTransactionPartial(selectedTransaction.id, amount, notes);
    setSelectedTransaction(null);
  };

  // Month summary
  const monthSummary = useMemo(() => {
    let income = 0;
    let expenses = 0;
    let projected = 0;
    let completed = 0;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startKey = formatDate(new Date(year, month, 1));
    const endKey = formatDate(new Date(year, month + 1, 0));

    transactions.forEach((t) => {
      const date = t.actualDate || t.scheduledDate;
      if (date >= startKey && date <= endKey) {
        // Skip skipped transactions from totals
        if (t.status === "skipped") return;

        const amount = t.actualAmount ?? t.projectedAmount;
        if (t.type === "income") {
          income += amount;
        } else {
          expenses += amount;
        }
        if (t.status === "projected" || t.status === "pending") projected++;
        if (t.status === "completed") completed++;
      }
    });

    return { income, expenses, net: income - expenses, projected, completed };
  }, [transactions, currentDate]);

  // Period balance summary (opening/closing for current view)
  const periodBalance = useMemo(() => {
    if (viewMode === "month") {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);

      const firstDayKey = formatDate(firstDay);
      const lastDayKey = formatDate(lastDay);

      const firstDayBalance = dailyBalances.get(firstDayKey);
      const lastDayBalance = dailyBalances.get(lastDayKey);

      return {
        openingBalance: firstDayBalance?.openingBalance ?? null,
        closingBalance: lastDayBalance?.closingBalance ?? null,
        startDateLabel: firstDay.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        endDateLabel: lastDay.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };
    } else {
      // Week view
      if (calendarWeekDays.length === 0) {
        return { openingBalance: null, closingBalance: null, startDateLabel: "", endDateLabel: "" };
      }

      const firstDay = calendarWeekDays[0];
      const lastDay = calendarWeekDays[6];

      return {
        openingBalance: firstDay.dayBalance?.openingBalance ?? null,
        closingBalance: lastDay.dayBalance?.closingBalance ?? null,
        startDateLabel: firstDay.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        endDateLabel: lastDay.date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };
    }
  }, [viewMode, currentDate, dailyBalances, calendarWeekDays]);

  if (isLoading) {
    return (
      <div className="p-6 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading calendar..." />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        title="Financial Calendar"
        description="Visualize your cash flow and upcoming transactions."
        actions={
          <div className="flex items-center gap-4">
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Today
            </Button>
            <div className="flex items-center gap-2 bg-gray-800 p-1 rounded-lg">
              <Button
                variant={viewMode === "month" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("month")}
              >
                Month
              </Button>
              <Button
                variant={viewMode === "week" ? "primary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("week")}
              >
                Week
              </Button>
            </div>
          </div>
        }
      />

      {/* Month Summary */}
      <MonthSummary
        income={monthSummary.income}
        expenses={monthSummary.expenses}
        net={monthSummary.net}
        projected={monthSummary.projected}
        completed={monthSummary.completed}
      />

      {/* Period Balance Summary (Opening/Closing) */}
      <PeriodBalanceSummary
        openingBalance={periodBalance.openingBalance}
        closingBalance={periodBalance.closingBalance}
        viewMode={viewMode}
        startDateLabel={periodBalance.startDateLabel}
        endDateLabel={periodBalance.endDateLabel}
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar Grid */}
        <div className={viewMode === "week" ? "lg:col-span-4" : "lg:col-span-3"}>
          <Card padding="none">
              {/* Header */}
              <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                <Button
                  variant="icon"
                  size="sm"
                  icon={<Icon name="chevron_left" />}
                  onClick={viewMode === "week" ? goToPrevWeek : goToPrevMonth}
                />
                <h2 className="text-xl font-bold text-white">
                  {viewMode === "week"
                    ? weekDateRange
                    : currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                </h2>
                <Button
                  variant="icon"
                  size="sm"
                  icon={<Icon name="chevron_right" />}
                  onClick={viewMode === "week" ? goToNextWeek : goToNextMonth}
                />
              </div>

              {/* Month View */}
              {viewMode === "month" && (
                <>
                  {/* Weekday headers */}
                  <div className="grid grid-cols-7 border-b border-gray-800">
                    {WEEKDAYS.map((day) => (
                      <div key={day} className="p-2 text-center text-sm font-medium text-gray-400">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, i) => (
                      <DayCell
                        key={i}
                        day={day}
                        isSelected={selectedDate?.toDateString() === day.date.toDateString()}
                        onClick={() => setSelectedDate(day.date)}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Week View */}
              {viewMode === "week" && (
                <div className="grid grid-cols-7">
                  {calendarWeekDays.map((day, i) => (
                    <WeekDayCell
                      key={i}
                      day={day}
                      isSelected={selectedDate?.toDateString() === day.date.toDateString()}
                      onClick={() => setSelectedDate(day.date)}
                      onTransactionClick={setSelectedTransaction}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="p-4 border-t border-gray-800 flex gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-success" />
                  <span className="text-gray-300">Income</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-danger" />
                  <span className="text-gray-300">Expense</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-primary" />
                  <span className="text-gray-300">Today</span>
                </div>
              </div>
            </Card>
        </div>

        {/* Day Detail Sidebar - Only show in month view */}
        {viewMode === "month" && (
          <div className="lg:col-span-1">
            <DayDetailSidebar
              selectedDate={selectedDate}
              dayBalance={selectedDayBalance || null}
              transactions={selectedDayTransactions}
              onTransactionClick={setSelectedTransaction}
            />
          </div>
        )}
      </div>

      {/* Transaction Modal */}
      {selectedTransaction && (
        <CompleteTransactionModal
          transaction={selectedTransaction}
          onComplete={handleComplete}
          onSkip={handleSkip}
          onPartial={handlePartial}
          onClose={() => setSelectedTransaction(null)}
        />
      )}
    </div>
  );
};

export default CalendarView;
