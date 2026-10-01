"use client";

import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  Announcements,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useFinancial } from "@/contexts/FinancialContext";
import { Transaction } from "@/lib/types";
import { Alert, Button, Card, PageHeader, Icon, LoadingSpinner } from "@/components/common";
import { formatDate, getTodayKey, isSameDay, parseDate, startOfDay } from "@/lib/utils/dateUtils";
import { rowDate } from "@/lib/logic/balanceCalculator/openItems";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { useDatePreferences } from "@/lib/hooks/useDatePreferences";
import { getBalanceStatus } from "@/lib/logic/balanceCalculator/utils";
import { summarizePeriod } from "@/lib/logic/healthScore";
import { useModal } from "@/components/modals";
import type { CalendarDay } from "./types";
import DayCell from "./components/DayCell";
import WeekDayCell from "./components/WeekDayCell";
import MonthSummary from "./components/MonthSummary";
import PeriodBalanceSummary from "./components/PeriodBalanceSummary";
import DayDetailSidebar from "./components/DayDetailSidebar";
import TransactionItem from "./components/TransactionItem";

// The drag overlay is wider than a day cell, so rect intersection picks a
// neighbouring cell. Drop on the cell under the pointer; fall back to rect
// intersection only when the pointer is outside every cell.
const dropUnderPointer: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

// Screen readers: name the transaction and the day, never the internal ids dnd-kit would read out.
const dayLabel = (key: unknown): string =>
  typeof key === "string"
    ? parseDate(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "no day";

const transactionLabel = (active: { data: { current?: Record<string, unknown> } }): string => {
  const txn = active.data.current?.transaction as Transaction | undefined;
  return txn ? `${txn.name}, ${dayLabel(rowDate(txn))}` : "transaction";
};

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${transactionLabel(active)}.`,
  onDragOver: ({ active, over }) =>
    over
      ? `${transactionLabel(active)} is over ${dayLabel(over.id)}.`
      : `${transactionLabel(active)} is not over a day.`,
  onDragEnd: ({ active, over }) =>
    over
      ? `${transactionLabel(active)} was dropped on ${dayLabel(over.id)}.`
      : `${transactionLabel(active)} was dropped outside the calendar and stays where it was.`,
  onDragCancel: ({ active }) => `Moving ${transactionLabel(active)} was cancelled.`,
};

const screenReaderInstructions = {
  draggable:
    "Drag this transaction onto another day to reschedule it. To change its date without dragging, open the transaction.",
};

const CalendarView: React.FC = () => {
  const {
    transactions,
    dailyBalances,
    isLoading,
    rescheduleTransaction,
    setViewDateRange,
    userProfile,
  } = useFinancial();
  const { openModal } = useModal();
  const { formatCurrency } = useCurrency();
  // Settings > Preferences: which day a week starts on, and day-before-month dates (MANUAL-L5)
  const { weekdayLabels, weekColumn, weekStart: startOfWeekOf, formatDayMonth, formatDayMonthYear } =
    useDatePreferences();
  // 7 columns on a phone leave ~50px per day: amounts print compact there (MANUAL-M4)
  const isCompact = useMediaQuery("(max-width: 767px)");

  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const calendarCardRef = useRef<HTMLDivElement | null>(null);
  const [draggingTransaction, setDraggingTransaction] = useState<Transaction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  // Calculate calendar days
  const calendarDays = useMemo((): CalendarDay[] => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = weekColumn(firstDay); // leading days from the previous month
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
  }, [currentDate, dailyBalances, weekColumn]);

  // Calculate week days for week view
  const calendarWeekDays = useMemo((): CalendarDay[] => {
    const today = startOfDay(new Date());
    const days: CalendarDay[] = [];

    // The start of the week (the preferred first day) containing currentDate
    const weekStart = startOfWeekOf(currentDate);

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
  }, [currentDate, dailyBalances, startOfWeekOf]);

  // Week date range for header
  const weekDateRange = useMemo(() => {
    if (calendarWeekDays.length === 0) return "";
    const start = calendarWeekDays[0].date;
    const end = calendarWeekDays[6].date;
    return `${formatDayMonth(start)} - ${formatDayMonthYear(end)}`;
  }, [calendarWeekDays, formatDayMonth, formatDayMonthYear]);

  // Selected day details
  const selectedDayKey = selectedDate ? formatDate(selectedDate) : null;
  const selectedDayBalance = selectedDayKey ? dailyBalances.get(selectedDayKey) : null;
  const selectedDayTransactions = selectedDayBalance?.transactions || [];

  // Current view range data (for sidebar when no day selected)
  const rangeInfo = useMemo(() => {
    let start: Date;
    let end: Date;

    if (viewMode === "month") {
      start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    } else {
      if (calendarWeekDays.length > 0) {
        start = calendarWeekDays[0].date;
        end = calendarWeekDays[6].date;
      } else {
        start = startOfWeekOf(currentDate);
        end = new Date(start);
        end.setDate(start.getDate() + 6);
      }
    }

    const startKey = formatDate(start);
    const endKey = formatDate(end);

    const rangeTransactions = transactions.filter((t) => {
      const date = t.actualDate || t.scheduledDate;
      return date >= startKey && date <= endKey;
    });

    // The one definition of a period's income and expenses (healthScore/periodStats.ts). The same
    // period feeds the sidebar AND the top tiles, so the tiles describe the month or the week on show.
    const period = summarizePeriod(transactions, startKey, endKey);

    return {
      start,
      end,
      startKey,
      endKey,
      income: period.income,
      expenses: period.expenses,
      period,
      transactions: rangeTransactions,
    };
  }, [viewMode, currentDate, transactions, calendarWeekDays, startOfWeekOf]);

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
    const newDate = new Date(currentDate.getTime());
    newDate.setDate(currentDate.getDate() - 7);
    // Update view date range to include the new week (expands if needed)
    const weekStart = startOfWeekOf(newDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    setViewDateRange(formatDate(weekStart), formatDate(weekEnd));
    setCurrentDate(newDate);
  };

  const goToNextWeek = () => {
    const newDate = new Date(currentDate.getTime());
    newDate.setDate(currentDate.getDate() + 7);
    // Update view date range to include the new week (expands if needed)
    const weekStart = startOfWeekOf(newDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    setViewDateRange(formatDate(weekStart), formatDate(weekEnd));
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  // Transaction handlers
  const openTransactionModal = useCallback(
    (transaction: Transaction) => {
      openModal("TransactionModal", { transaction });
    },
    [openModal]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const txn = event.active.data.current?.transaction as Transaction | undefined;
    if (txn) {
      setDraggingTransaction(txn);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const txn = event.active.data.current?.transaction as Transaction | undefined;
    const targetDate = (event.over?.id as string) || null;
    setDraggingTransaction(null);
    if (!txn || !targetDate) return;

    const currentDate = txn.actualDate || txn.scheduledDate;
    if (currentDate === targetDate) return;

    setActionError(null);
    try {
      await rescheduleTransaction(txn.id, targetDate);
    } catch (err) {
      // a rejected move used to be an unhandled rejection: the item snapped back and nobody was told
      setActionError(err instanceof Error ? err.message : "Failed to move the transaction");
    }
  };

  // Summary tiles: the period being viewed (the month, or the week in week view; MANUAL-M2).
  // Skipped rows are in no total and in neither count (summarizePeriod keeps them apart)
  const periodSummary = {
    income: rangeInfo.period.income,
    expenses: rangeInfo.period.expenses,
    net: rangeInfo.period.net,
    projected: rangeInfo.period.pendingIncomeCount + rangeInfo.period.pendingExpenseCount,
    completed: rangeInfo.period.completedCount,
  };

  // Today's balance is a projection when something is overdue (MANUAL-M6): the Dashboard prints the
  // realized balance, the calendar deducts what is owed. Say so, with both figures.
  const todayKey = getTodayKey();
  const todayBalance = dailyBalances.get(todayKey);
  const overdueOwed = todayBalance?.overdueOwed ?? 0;
  const todayInView = rangeInfo.startKey <= todayKey && todayKey <= rangeInfo.endKey;

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
        startDateLabel: formatDayMonth(firstDay),
        endDateLabel: formatDayMonth(lastDay),
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
        startDateLabel: formatDayMonth(firstDay.date),
        endDateLabel: formatDayMonth(lastDay.date),
      };
    }
  }, [viewMode, currentDate, dailyBalances, calendarWeekDays, formatDayMonth]);

  const warningThreshold = userProfile?.preferences?.defaultWarningThreshold ?? 0;
  const rangeClosing = periodBalance.closingBalance;
  const rangeStatus =
    rangeClosing !== null && rangeClosing !== undefined
      ? getBalanceStatus(rangeClosing, warningThreshold)
      : "safe";
  const dayOpeningStatus =
    selectedDayBalance && selectedDayBalance.openingBalance !== undefined
      ? getBalanceStatus(selectedDayBalance.openingBalance, warningThreshold)
      : "safe";
  const rangeOpeningStatus =
    periodBalance.openingBalance !== null && periodBalance.openingBalance !== undefined
      ? getBalanceStatus(periodBalance.openingBalance, warningThreshold)
      : "safe";

  if (isLoading) {
    return (
      <div className="p-4 lg:p-10 flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" text="Loading calendar..." />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements, screenReaderInstructions }}
      collisionDetection={dropUnderPointer}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="p-4 lg:p-10 max-w-7xl mx-auto animate-fade-in">
        <PageHeader
          title="Financial Calendar"
          description="Visualize your cash flow and upcoming transactions."
          actions={
            <div className="flex flex-wrap items-center gap-2 lg:gap-4">
              <Button variant="secondary" size="sm" onClick={goToToday}>
                Today
              </Button>
              <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-lg">
                <Button
                  variant={viewMode === "month" ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setViewMode("month");
                    setSelectedDate(null);
                  }}
                >
                  Month
                </Button>
                <Button
                  variant={viewMode === "week" ? "primary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setViewMode("week");
                    setSelectedDate(null);
                  }}
                >
                  Week
                </Button>
              </div>
            </div>
          }
        />

        {actionError && (
          <Alert variant="error" className="mb-4">
            {actionError}
          </Alert>
        )}

        {/* Month Summary */}
        <MonthSummary
          income={periodSummary.income}
          expenses={periodSummary.expenses}
          net={periodSummary.net}
          projected={periodSummary.projected}
          completed={periodSummary.completed}
        />

        {/* Period Balance Summary (Opening/Closing) */}
        <PeriodBalanceSummary
          openingBalance={periodBalance.openingBalance}
          closingBalance={periodBalance.closingBalance}
          viewMode={viewMode}
          startDateLabel={periodBalance.startDateLabel}
          endDateLabel={periodBalance.endDateLabel}
        />

        {overdueOwed > 0 && todayInView && todayBalance && (
          <div
            className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs lg:text-sm text-gray-300"
          >
            <Icon name="info" size={16} className="mt-0.5 text-warning flex-shrink-0" />
            <p>
              Today&apos;s closing balance on the calendar, {formatCurrency(todayBalance.closingBalance)},
              is projected: it deducts {formatCurrency(overdueOwed)} of overdue bills that are still
              unpaid and counts what is still due today. Your current balance is{" "}
              {formatCurrency(userProfile?.currentBalance ?? 0)} and only changes when they are paid.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">
          {/* Calendar Grid */}
          <div className="lg:col-span-3 order-1">
            <Card padding="none" ref={calendarCardRef}>
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
                    {weekdayLabels.map((day) => (
                      <div
                        key={day}
                        className="p-1 lg:p-2 text-center text-xs lg:text-sm font-medium text-gray-400"
                      >
                        <span className="hidden sm:inline">{day}</span>
                        <span className="sm:hidden">{day[0]}</span>
                      </div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7">
                    {calendarDays.map((day, i) => (
                      <DayCell
                        key={i}
                        day={day}
                        compact={isCompact}
                        isSelected={selectedDate ? isSameDay(selectedDate, day.date) : false}
                        onTransactionClick={openTransactionModal}
                        onClick={() =>
                          setSelectedDate((prev) =>
                            prev && isSameDay(prev, day.date) ? null : day.date
                          )
                        }
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
                      compact={isCompact}
                      isSelected={selectedDate ? isSameDay(selectedDate, day.date) : false}
                      onClick={() =>
                        setSelectedDate((prev) =>
                          prev && isSameDay(prev, day.date) ? null : day.date
                        )
                      }
                      onTransactionClick={openTransactionModal}
                    />
                  ))}
                </div>
              )}

              {/* Legend */}
              <div className="p-3 lg:p-4 border-t border-gray-800 flex flex-wrap gap-3 lg:gap-6 text-xs lg:text-sm">
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
          <div className="lg:col-span-1 order-2">
            <DayDetailSidebar
              selectedDate={selectedDate}
              dayBalance={selectedDayBalance || null}
              transactions={selectedDayTransactions}
              onTransactionClick={openTransactionModal}
              rangeLabel={
                viewMode === "month"
                  ? `${periodBalance.startDateLabel} - ${periodBalance.endDateLabel}`
                  : weekDateRange
              }
              rangeOpening={periodBalance.openingBalance}
              rangeClosing={periodBalance.closingBalance}
              viewMode={viewMode}
              rangeIncome={rangeInfo.income}
              rangeExpenses={rangeInfo.expenses}
              rangeTransactions={rangeInfo.transactions}
              rangeStatus={rangeStatus}
              dayOpeningStatus={dayOpeningStatus}
              rangeOpeningStatus={rangeOpeningStatus}
            />
          </div>
        </div>
      </div>

      <DragOverlay>
        {draggingTransaction ? (
          <div className="w-[221px] max-w-sm drop-shadow-lg">
            <TransactionItem transaction={draggingTransaction} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

export default CalendarView;
