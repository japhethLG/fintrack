/**
 * Shared generation of projected transactions for a plain recurring schedule
 * (income sources and standard expense rules).
 *
 * Identity is derived from each occurrence's LOGICAL date; the weekend-adjusted
 * date only decides where the row is shown. An occurrence override may relocate
 * a row (`scheduledDate`), so the window is applied to the row's FINAL date:
 * a row dragged out of the window is not emitted by it, and a row dragged into
 * the window from outside is found there.
 */

import { ExpenseRule, IncomeSource, Transaction, TransactionType } from "@/lib/types";
import { addDays, formatDate } from "@/lib/utils/dateUtils";
import { Occurrence, calculateOccurrencesDetailed } from "./occurrenceCalculator";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

type Projection = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

/**
 * How far outside the view window we look for occurrences that an override has
 * relocated INTO the window. A drag moves a row within (or near) the calendar the
 * user is looking at, so a year either side is ample.
 */
const RELOCATION_LOOKAROUND_DAYS = 366;

export const generateRecurringProjections = (
  source: IncomeSource | ExpenseRule,
  type: TransactionType,
  sourceType: "income_source" | "expense_rule",
  viewStartDate: Date,
  viewEndDate: Date
): Projection[] => {
  const params = {
    frequency: source.frequency,
    startDate: source.startDate,
    endDate: source.endDate,
    scheduleConfig: source.scheduleConfig,
    weekendAdjustment: source.weekendAdjustment,
  };
  const overrides = source.occurrenceOverrides ?? {};
  const windowStart = formatDate(viewStartDate);
  const windowEnd = formatDate(viewEndDate);
  const inWindow = (ymd: string) => ymd >= windowStart && ymd <= windowEnd;

  const idOf = (occurrence: Occurrence) =>
    generateOccurrenceId(
      source.id,
      source.frequency,
      occurrence.logicalDate,
      source.startDate,
      source.scheduleConfig
    );

  const candidates = calculateOccurrencesDetailed(params, viewStartDate, viewEndDate).map(
    (occurrence) => ({ occurrence, id: idOf(occurrence) })
  );

  // Rows an override has moved into this window from outside it.
  const present = new Set(candidates.map((c) => c.id));
  const hasRelocatedIn = Object.entries(overrides).some(
    ([id, override]) =>
      !present.has(id) &&
      !override?.skipped &&
      typeof override?.scheduledDate === "string" &&
      inWindow(override.scheduledDate)
  );
  if (hasRelocatedIn) {
    const before = [
      addDays(viewStartDate, -RELOCATION_LOOKAROUND_DAYS),
      addDays(viewStartDate, -1),
    ];
    const after = [addDays(viewEndDate, 1), addDays(viewEndDate, RELOCATION_LOOKAROUND_DAYS)];
    for (const [from, to] of [before, after]) {
      for (const occurrence of calculateOccurrencesDetailed(params, from, to)) {
        candidates.push({ occurrence, id: idOf(occurrence) });
      }
    }
  }

  const rows: { projection: Projection; sortKey: string }[] = [];
  for (const { occurrence, id } of candidates) {
    const override = overrides[id];
    const projection = createProjectedTransaction(
      source,
      occurrence.date,
      type,
      sourceType,
      undefined,
      id,
      override
    );
    if (projection === null || !inWindow(projection.scheduledDate)) continue;
    rows.push({ projection, sortKey: projection.scheduledDate });
  }
  rows.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  return rows.map((r) => r.projection);
};
