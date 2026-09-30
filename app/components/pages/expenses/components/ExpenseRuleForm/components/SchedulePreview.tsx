"use client";

import React, { useMemo } from "react";
import { Card } from "@/components/common";
import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { getSchedulePreview, PREVIEW_HORIZON_MONTHS } from "@/lib/logic/ruleSchedule";

/** How many dates are drawn as cards; the rest are counted in "+N more occurrences". */
const MAX_CARDS = 8;

interface IProps {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string | null;
  hasEndDate: boolean;
  weekendAdjustment: "before" | "after" | "none";
  /** The `scheduleConfig` the form will save (its `buildScheduleConfig`), so the preview IS the saved rule. */
  scheduleConfig: ScheduleConfig;
  /** A plan with a fixed number of payments (loan term, installment count). */
  maxOccurrences?: number;
}

/**
 * The dates the saved rule will generate. This is the projection engine itself
 * (`calculateOccurrencesDetailed` through `getSchedulePreview`), fed the same frequency, weekday, day of
 * month, weekend adjustment and end date as the rule the form saves; nothing is re-implemented here.
 */
const SchedulePreview: React.FC<IProps> = ({
  frequency,
  startDate,
  endDate,
  hasEndDate,
  weekendAdjustment,
  scheduleConfig,
  maxOccurrences,
}) => {
  const { dates } = useMemo(
    () =>
      getSchedulePreview({
        frequency,
        startDate,
        endDate,
        hasEndDate,
        weekendAdjustment,
        scheduleConfig,
        maxOccurrences,
      }),
    [frequency, startDate, endDate, hasEndDate, weekendAdjustment, scheduleConfig, maxOccurrences]
  );

  if (dates.length === 0) return null;

  const showsHorizon = !(hasEndDate && endDate) && frequency !== "one-time";

  return (
    <Card padding="md" className="mt-6">
      <h4 className="font-bold text-white mb-1">Schedule Preview</h4>
      {showsHorizon && (
        <p className="text-xs text-gray-500 mb-3">
          The first {PREVIEW_HORIZON_MONTHS} months from the start date, as they will be scheduled
        </p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {dates.slice(0, MAX_CARDS).map((date, i) => (
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
      {dates.length > MAX_CARDS && (
        <p className="text-xs text-gray-500 mt-3 text-center">
          +{dates.length - MAX_CARDS} more occurrences
        </p>
      )}
    </Card>
  );
};

export default SchedulePreview;
