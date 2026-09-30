"use client";

import { useEffect, useRef } from "react";
import { startDateParts, toWholeNumber } from "@/lib/logic/ruleSchedule";

interface Options {
  /** The form's current start date ("YYYY-MM-DD"). */
  startDate: string | null | undefined;
  /** Which hidden schedule values the user has not set yet (true for a new rule; for an edit, the ones the stored rule lacks). */
  implicit: { dayOfMonth: boolean; dayOfWeek: boolean };
  /** Read the form's current values. */
  get: () => { dayOfMonth: unknown; dayOfWeek: unknown };
  /** Write the derived values into the form. */
  set: (patch: { dayOfMonth?: number; dayOfWeek?: number }) => void;
}

/**
 * Keeps a form's Day of Month / Day of Week in step with the START DATE until the user changes them
 * explicitly. "Changes explicitly" means the field no longer holds the value this hook last derived; from
 * then on the field is the user's and the start date never overwrites it.
 *
 * Why: these values used to default to TODAY, so entering a first payment of Mar 5 billed on Mar 15.
 */
export const useFollowStartDate = ({ startDate, implicit, get, set }: Options): void => {
  const initial = startDateParts(startDate);
  const lastAuto = useRef<{ dayOfMonth?: number; dayOfWeek?: number }>({
    dayOfMonth: implicit.dayOfMonth ? initial?.dayOfMonth : undefined,
    dayOfWeek: implicit.dayOfWeek ? initial?.dayOfWeek : undefined,
  });

  // `get`/`set` are fresh closures every render; the effect must run only when the start date changes.
  const latest = useRef({ get, set });
  latest.current = { get, set };

  useEffect(() => {
    const parts = startDateParts(startDate);
    if (!parts) return;
    const current = latest.current.get();
    const patch: { dayOfMonth?: number; dayOfWeek?: number } = {};

    const auto = lastAuto.current;
    if (auto.dayOfMonth !== undefined) {
      if (toWholeNumber(current.dayOfMonth) !== auto.dayOfMonth) {
        auto.dayOfMonth = undefined; // the user took over
      } else if (parts.dayOfMonth !== auto.dayOfMonth) {
        patch.dayOfMonth = parts.dayOfMonth;
        auto.dayOfMonth = parts.dayOfMonth;
      }
    }
    if (auto.dayOfWeek !== undefined) {
      if (toWholeNumber(current.dayOfWeek) !== auto.dayOfWeek) {
        auto.dayOfWeek = undefined;
      } else if (parts.dayOfWeek !== auto.dayOfWeek) {
        patch.dayOfWeek = parts.dayOfWeek;
        auto.dayOfWeek = parts.dayOfWeek;
      }
    }
    if (patch.dayOfMonth !== undefined || patch.dayOfWeek !== undefined) latest.current.set(patch);
  }, [startDate]);
};
