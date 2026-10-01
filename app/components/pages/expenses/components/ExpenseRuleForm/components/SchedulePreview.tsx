"use client";

import React, { useMemo } from "react";
import { Card } from "@/components/common";
import type { IncomeFrequency, ScheduleConfig } from "@/lib/types";
import { getSchedulePreview, PREVIEW_HORIZON_MONTHS } from "@/lib/logic/ruleSchedule";

/** "Sun Nov 1" */
const dayLabel = (date: Date): string =>
  `${date.toLocaleDateString("en-US", { weekday: "short" })} ${date.toLocaleDateString("en-US", { month: "short" })} ${date.getDate()}`;

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
  /** A plan with a fixed number of payments (loan term, installment count): the REMAINING ones. */
  maxOccurrences?: number;
  /** Payments already made: the preview starts at the next one due. */
  alreadyPaid?: number;
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
  alreadyPaid = 0,
}) => {
  const { occurrences } = useMemo(
    () =>
      getSchedulePreview({
        frequency,
        startDate,
        endDate,
        hasEndDate,
        weekendAdjustment,
        scheduleConfig,
        maxOccurrences,
        alreadyPaid,
      }),
    [frequency, startDate, endDate, hasEndDate, weekendAdjustment, scheduleConfig, maxOccurrences, alreadyPaid]
  );

  if (occurrences.length === 0) return null;

  const showsHorizon = !(hasEndDate && endDate) && frequency !== "one-time";

  return (
    <Card padding="md" className="mt-6">
      <h4 className="font-bold text-white mb-1">Schedule Preview</h4>
      {alreadyPaid > 0 ? (
        <p className="text-xs text-gray-500 mb-3">
          The payments still to make ({alreadyPaid} already paid), as they will be scheduled
        </p>
      ) : (
        showsHorizon && (
          <p className="text-xs text-gray-500 mb-3">
            The first {PREVIEW_HORIZON_MONTHS} months from the start date, as they will be scheduled
          </p>
        )
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {occurrences.slice(0, MAX_CARDS).map(({ date, logicalDate }, i) => {
          // A weekend adjustment moved this payment off the day it is nominally due: say so
          const moved = date.getTime() !== logicalDate.getTime();
          return (
            <div key={i} className="bg-gray-800 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-400">
                {date.toLocaleDateString("en-US", { month: "short" })}
              </p>
              <p className="text-2xl font-bold text-white">{date.getDate()}</p>
              <p className="text-xs text-gray-400">
                {date.toLocaleDateString("en-US", { weekday: "short" })}
              </p>
              {moved && (
                <span className="block text-[11px] leading-tight text-gray-500 mt-1">
                  (moved from {dayLabel(logicalDate)})
                </span>
              )}
            </div>
          );
        })}
      </div>
      {occurrences.length > MAX_CARDS && (
        <p className="text-xs text-gray-500 mt-3 text-center">
          +{occurrences.length - MAX_CARDS} more occurrences
        </p>
      )}
    </Card>
  );
};

export default SchedulePreview;
