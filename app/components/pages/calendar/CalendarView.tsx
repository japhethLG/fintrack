"use client";

import React, { useState, useMemo } from "react";
import { useFinancial } from "@/contexts/FinancialContext";
import { Button, Card, PageHeader, Icon, LoadingSpinner } from "@/components/common";
import { formatDate, isSameDay, startOfDay } from "@/lib/utils/dateUtils";
import { WEEKDAYS } from "./constants";
import type { CalendarDay } from "./types";
import DayCell from "./components/DayCell";
import MonthSummary from "./components/MonthSummary";
import DayDetailSidebar from "./components/DayDetailSidebar";

const CalendarView: React.FC = () => {
  const { transactions, dailyBalances, isLoading, userProfile } = useFinancial();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week">("month");

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

  // Selected day details
  const selectedDayKey = selectedDate ? formatDate(selectedDate) : null;
  const selectedDayBalance = selectedDayKey ? dailyBalances.get(selectedDayKey) : null;
  const selectedDayTransactions = selectedDayBalance?.transactions || [];

  // Navigation
  const goToPrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar Grid */}
        <div className="lg:col-span-3">
          <Card padding="none">
            {/* Header */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
              <Button
                variant="icon"
                size="sm"
                icon={<Icon name="chevron_left" />}
                onClick={goToPrevMonth}
              />
              <h2 className="text-xl font-bold text-white">
                {currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h2>
              <Button
                variant="icon"
                size="sm"
                icon={<Icon name="chevron_right" />}
                onClick={goToNextMonth}
              />
            </div>

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

        {/* Day Detail Sidebar */}
        <div className="lg:col-span-1">
          <DayDetailSidebar
            selectedDate={selectedDate}
            dayBalance={selectedDayBalance || null}
            transactions={selectedDayTransactions}
          />
        </div>
      </div>
    </div>
  );
};

export default CalendarView;
