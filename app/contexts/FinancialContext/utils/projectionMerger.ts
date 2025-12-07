import { Transaction, IncomeSource, ExpenseRule } from "@/lib/types";
import { generateProjections } from "@/lib/logic/projectionEngine";

/**
 * Merges stored transactions with generated projections
 * Stored transactions take precedence over projections for the same source+date
 */
export function mergeTransactionsWithProjections(
  storedTransactions: Transaction[],
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[],
  viewDateRange: { start: string; end: string },
  userId: string | undefined
): Transaction[] {
  const getKey = (t: { sourceId?: string; scheduledDate: string; occurrenceId?: string }) =>
    t.occurrenceId || (t.sourceId ? `${t.sourceId}-${t.scheduledDate}` : t.scheduledDate);

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
    new Date(viewDateRange.start),
    new Date(viewDateRange.end)
  );

  // Create lookup map of stored transactions by key (sourceId + scheduledDate)
  // This allows us to match stored transactions with their projected counterparts
  const storedByKey = new Map<string, Transaction>();
  storedTransactions.forEach((t) => {
    if (t.sourceId) {
      const key = getKey(t);
      storedByKey.set(key, t);
    }
  });

  // Merge: stored transactions take precedence over projections
  const mergedTransactions: Transaction[] = projections.map((proj) => {
    const key = getKey(proj);
    const stored = storedByKey.get(key);

    if (stored) {
      // Use stored transaction (completed, skipped, etc.) - remove from map
      storedByKey.delete(key);
      return stored;
    }

    // Return projection with deterministic ID
    const projectionIdParts = [proj.sourceId, proj.scheduledDate, proj.occurrenceId || ""].filter(
      Boolean
    );
    const projectionId = projectionIdParts.join("::");

    return {
      ...proj,
      id: `proj_${projectionId}`, // Deterministic ID for projections (occurrence-aware)
      userId: userId || "",
      createdAt: null as unknown as Transaction["createdAt"],
      updatedAt: null as unknown as Transaction["updatedAt"],
    } as Transaction;
  });

  // Add any manual transactions (no sourceId) and remaining stored transactions
  // that weren't matched (e.g., from sources that no longer exist or are inactive)
  storedTransactions.forEach((t) => {
    if (!t.sourceId) {
      // Manual transaction - always include
      mergedTransactions.push(t);
    } else {
      const key = getKey(t);
      if (storedByKey.has(key)) {
        // Stored transaction that didn't match any projection - include it
        mergedTransactions.push(t);
      }
    }
  });

  // Sort by scheduled date
  mergedTransactions.sort((a, b) => {
    const dateA = a.actualDate || a.scheduledDate;
    const dateB = b.actualDate || b.scheduledDate;
    return dateA.localeCompare(dateB);
  });

  return mergedTransactions;
}
