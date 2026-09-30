/**
 * Where a rule's pattern would put one occurrence, ignoring any user override.
 *
 * Reverting a completed occurrence deletes its stored row; the row then comes
 * back as a projection. If the user had moved the row off its pattern date that
 * custom date must be preserved as an override, and ONLY then: a never-moved
 * occurrence must not get a spurious override (E2E-CAL-04), and a weekly,
 * bi-weekly, semi-monthly or loan occurrence must be recognised as moved too
 * (UI-LIFE-25/25b). The pattern date is therefore asked of the projection engine
 * itself (logical date -> weekend adjustment -> override), not reconstructed from
 * the shape of the occurrence id.
 */

import { ExpenseRule, IncomeSource } from "@/lib/types";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { addDays, formatDate, parseDate } from "@/lib/utils/dateUtils";

type Source = IncomeSource | ExpenseRule;

/** `<source>_YYYY-MM-DD`: a daily occurrence's id IS its day. */
const DAILY_ID = /_(\d{4}-\d{2}-\d{2})$/;

/** Windows tried, in days either side of the stored row, before giving up. */
const SEARCH_RADII = [45, 400];

/**
 * The date the rule's pattern gives `occurrenceId`, or null when it cannot be
 * found (the rule changed since, the occurrence no longer exists). Overrides of
 * THIS occurrence are ignored: the answer is where the pattern puts it.
 */
export const patternDateOfOccurrence = (
  source: Source,
  isIncome: boolean,
  occurrenceId: string,
  nearDate: string
): string | null => {
  const daily = DAILY_ID.exec(occurrenceId);
  if (daily) return daily[1];

  const overrides = { ...(source.occurrenceOverrides ?? {}) };
  delete overrides[occurrenceId];
  const bare = { ...source, occurrenceOverrides: overrides } as Source;

  const anchor = parseDate(nearDate);
  for (const radius of SEARCH_RADII) {
    const projections = generateProjections(
      isIncome ? [bare as IncomeSource] : [],
      isIncome ? [] : [bare as ExpenseRule],
      parseDate(formatDate(addDays(anchor, -radius))),
      parseDate(formatDate(addDays(anchor, radius)))
    );
    const hit = projections.find((p) => p.sourceId === source.id && p.occurrenceId === occurrenceId);
    if (hit) return hit.scheduledDate;
  }
  return null;
};
