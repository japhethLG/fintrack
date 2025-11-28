"use client";

import React, { useMemo } from "react";
import { Card } from "@/components/common";
import { parseDate, addMonths } from "@/lib/utils/dateUtils";
import type { IncomeFrequency } from "@/lib/types";

interface IProps {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;
  hasEndDate: boolean;
  specificDays: number[];
  weekendAdjustment: "before" | "after" | "none";
  dayOfMonth?: number;
  creditDueDate?: number;
}

const SchedulePreview: React.FC<IProps> = ({
  frequency,
  startDate,
  endDate,
  hasEndDate,
  specificDays,
  weekendAdjustment,
  dayOfMonth,
  creditDueDate,
}) => {
  const previewDates = useMemo(() => {
    const dates: Date[] = [];
    const start = parseDate(startDate);
    const end = hasEndDate && endDate ? parseDate(endDate) : addMonths(new Date(start), 3);

    const effectiveEnd =
      hasEndDate && endDate ? new Date(Math.min(end.getTime(), parseDate(endDate).getTime())) : end;

    const current = new Date(start);

    const addOccurrence = (date: Date) => {
      if (date >= start && date <= effectiveEnd && dates.length < 12) {
        const day = date.getDay();
        if (weekendAdjustment === "before") {
          if (day === 0) date.setDate(date.getDate() - 2);
          else if (day === 6) date.setDate(date.getDate() - 1);
        } else if (weekendAdjustment === "after") {
          if (day === 0) date.setDate(date.getDate() + 1);
          else if (day === 6) date.setDate(date.getDate() + 2);
        }
        dates.push(new Date(date));
      }
    };

    switch (frequency) {
      case "one-time":
        addOccurrence(current);
        break;
      case "daily":
        while (dates.length < 12 && current <= effectiveEnd) {
          addOccurrence(new Date(current));
          current.setDate(current.getDate() + 1);
        }
        break;
      case "weekly":
        while (dates.length < 12 && current <= effectiveEnd) {
          addOccurrence(new Date(current));
          current.setDate(current.getDate() + 7);
        }
        break;
      case "bi-weekly":
        while (dates.length < 12 && current <= effectiveEnd) {
          addOccurrence(new Date(current));
          current.setDate(current.getDate() + 14);
        }
        break;
      case "semi-monthly":
        const monthCursor = new Date(start);
        monthCursor.setDate(1);
        while (dates.length < 12 && monthCursor <= effectiveEnd) {
          specificDays.forEach((day) => {
            const date = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day);
            if (date >= start) {
              addOccurrence(date);
            }
          });
          monthCursor.setMonth(monthCursor.getMonth() + 1);
        }
        break;
      case "monthly": {
        // For credit cards, use the due date; otherwise use dayOfMonth or start date
        const targetDay = creditDueDate || dayOfMonth || start.getDate();
        const monthCursor = new Date(start.getFullYear(), start.getMonth(), 1);

        while (dates.length < 12 && monthCursor <= effectiveEnd) {
          const year = monthCursor.getFullYear();
          const month = monthCursor.getMonth();
          // Clamp day to valid range for the month
          const maxDay = new Date(year, month + 1, 0).getDate();
          const actualDay = Math.min(targetDay, maxDay);
          const date = new Date(year, month, actualDay);

          // Only add if on or after start date
          if (date >= start) {
            addOccurrence(new Date(date));
          }
          monthCursor.setMonth(monthCursor.getMonth() + 1);
        }
        break;
      }
      case "quarterly":
        while (dates.length < 12 && current <= effectiveEnd) {
          addOccurrence(new Date(current));
          current.setMonth(current.getMonth() + 3);
        }
        break;
      case "yearly":
        while (dates.length < 12 && current <= effectiveEnd) {
          addOccurrence(new Date(current));
          current.setFullYear(current.getFullYear() + 1);
        }
        break;
    }

    return dates.sort((a, b) => a.getTime() - b.getTime());
  }, [startDate, endDate, hasEndDate, frequency, specificDays, weekendAdjustment, dayOfMonth, creditDueDate]);

  if (previewDates.length === 0) return null;

  return (
    <Card padding="md" className="mt-6">
      <h4 className="font-bold text-white mb-4">Schedule Preview</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {previewDates.slice(0, 8).map((date, i) => (
          <div key={i} className="bg-gray-800 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400">
              {date.toLocaleDateString("en-US", { month: "short" })}
            </p>
            <p className="text-2xl font-bold text-white">{date.getDate()}</p>
            <p className="text-xs text-gray-400">
              {date.toLocaleDateString("en-US", { weekday: "short" })}
            </p>
          </div>
        ))}
      </div>
      {previewDates.length > 8 && (
        <p className="text-xs text-gray-500 mt-3 text-center">
          +{previewDates.length - 8} more occurrences
        </p>
      )}
    </Card>
  );
};

export default SchedulePreview;
