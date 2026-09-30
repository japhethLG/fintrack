import { Transaction, IncomeSource, ExpenseRule } from "@/lib/types";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { generateLegacyOccurrenceId } from "@/lib/logic/projectionEngine/legacyOccurrenceId";
import { parseDate } from "@/lib/utils/dateUtils";

type Projection = ReturnType<typeof generateProjections>[number];

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/**
 * Merges stored transactions with generated projections.
 *
 * A stored transaction (completed, skipped, edited) REPLACES the projection it
 * was written for. The merge is defensive about identity:
 *
 *  - a projection is matched by at most ONE stored row, and a stored row
 *    replaces at most ONE projection (consumed rows are not reused);
 *  - every stored row that is not consumed is emitted, so two stored rows can
 *    never collapse into one (a `Map` keyed by id silently dropped all but the
 *    last, while the dropped row's balance effect stayed applied);
 *  - matching runs in passes, most specific first:
 *      1. same occurrenceId AND same scheduled date;
 *      2. the occurrenceId an older version derived from the weekend-ADJUSTED
 *         date (see legacyOccurrenceId.ts) AND the same scheduled date, so rows
 *         written under the old, colliding ids find their own occurrence;
 *      3. same occurrenceId on any date (the row was moved/rescheduled);
 *      4. a row with NO occurrenceId at all (written before ids existed) matches
 *         on sourceId + scheduledDate.
 *
 * The window bounds are local calendar days (`parseDate`), never UTC instants.
 */
export function mergeTransactionsWithProjections(
  storedTransactions: Transaction[],
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[],
  viewDateRange: { start: string; end: string },
  userId: string | undefined
): Transaction[] {
  // Filter active sources and rules
  const activeIncomeSources = incomeSources.filter((s) => s.isActive);
  const activeExpenseRules = expenseRules.filter((r) => r.isActive);

  // Skip projection generation if no sources/rules
  if (activeIncomeSources.length === 0 && activeExpenseRules.length === 0) {
    return storedTransactions;
  }

  // Generate projections for the view date range
  const projections = generateProjections(
    activeIncomeSources,
    activeExpenseRules,
    parseDate(viewDateRange.start),
    parseDate(viewDateRange.end)
  );

  // Index the stored rows that can stand in for a projection (those with a source).
  const byOccurrenceId = new Map<string, number[]>();
  const bySourceAndDate = new Map<string, number[]>();
  const legacyBySourceAndDate = new Map<string, number[]>(); // rows with no occurrenceId
  storedTransactions.forEach((t, index) => {
    if (!t.sourceId) return;
    if (t.occurrenceId) {
      pushTo(byOccurrenceId, t.occurrenceId, index);
      pushTo(bySourceAndDate, `${t.sourceId}\u0000${t.scheduledDate}`, index);
    } else {
      pushTo(legacyBySourceAndDate, `${t.sourceId}\u0000${t.scheduledDate}`, index);
    }
  });

  const consumed = new Set<number>();
  const matchOf: (number | undefined)[] = new Array(projections.length).fill(undefined);
  const take = (candidates: number[] | undefined, accept: (index: number) => boolean) => {
    for (const index of candidates ?? []) {
      if (!consumed.has(index) && accept(index)) {
        consumed.add(index);
        return index;
      }
    }
    return undefined;
  };

  const sourcesById = new Map<string, IncomeSource | ExpenseRule>();
  [...activeIncomeSources, ...activeExpenseRules].forEach((s) => sourcesById.set(s.id, s));

  const runPass = (match: (proj: Projection) => number | undefined) => {
    projections.forEach((proj, i) => {
      if (matchOf[i] === undefined) matchOf[i] = match(proj);
    });
  };

  // Pass 1: same id, same date.
  runPass((proj) =>
    take(
      byOccurrenceId.get(proj.occurrenceId ?? "\u0000none"),
      (index) => storedTransactions[index].scheduledDate === proj.scheduledDate
    )
  );

  // Pass 2: the id an older version derived from the adjusted date, same date.
  runPass((proj) => {
    const source = proj.sourceId ? sourcesById.get(proj.sourceId) : undefined;
    if (!source) return undefined;
    const candidates = bySourceAndDate.get(`${proj.sourceId}\u0000${proj.scheduledDate}`);
    if (!candidates) return undefined;
    const legacyId = generateLegacyOccurrenceId(
      source.id,
      source.frequency,
      parseDate(proj.scheduledDate),
      source.startDate,
      source.scheduleConfig
    );
    return take(candidates, (index) => storedTransactions[index].occurrenceId === legacyId);
  });

  // Pass 3: same id, any date (rescheduled / moved rows).
  runPass((proj) => take(byOccurrenceId.get(proj.occurrenceId ?? "\u0000none"), () => true));

  // Pass 4: rows written before occurrence ids existed.
  runPass((proj) =>
    take(legacyBySourceAndDate.get(`${proj.sourceId}\u0000${proj.scheduledDate}`), () => true)
  );

  // Merge: a matched stored transaction takes precedence over its projection.
  const usedProjectionIds = new Set<string>();
  const mergedTransactions: Transaction[] = projections.map((proj, i) => {
    const matched = matchOf[i];
    if (matched !== undefined) return storedTransactions[matched];

    // Return projection with deterministic ID (occurrence-aware)
    const projectionIdParts = [proj.sourceId, proj.scheduledDate, proj.occurrenceId || ""].filter(
      Boolean
    );
    let projectionId = `proj_${projectionIdParts.join("::")}`;
    // Ids must be pairwise distinct (React keys, drag ids, override targets).
    for (let n = 2; usedProjectionIds.has(projectionId); n++) {
      projectionId = `proj_${projectionIdParts.join("::")}::${n}`;
    }
    usedProjectionIds.add(projectionId);

    return {
      ...proj,
      id: projectionId,
      userId: userId || "",
      createdAt: null as unknown as Transaction["createdAt"],
      updatedAt: null as unknown as Transaction["updatedAt"],
    } as Transaction;
  });

  // Add every stored row that did not replace a projection: manual transactions,
  // rows whose source is gone or inactive, rows outside the window, and surplus rows.
  storedTransactions.forEach((t, index) => {
    if (!consumed.has(index)) mergedTransactions.push(t);
  });

  // Sort by scheduled date (stable, so equal dates keep their relative order)
  mergedTransactions.sort((a, b) => {
    const dateA = a.actualDate || a.scheduledDate;
    const dateB = b.actualDate || b.scheduledDate;
    return dateA < dateB ? -1 : dateA > dateB ? 1 : 0;
  });

  return mergedTransactions;
}
