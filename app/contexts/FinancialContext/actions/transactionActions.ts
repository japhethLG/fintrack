import {
  Transaction,
  CompleteTransactionData,
  IncomeSource,
  ExpenseRule,
} from "@/lib/types";
import {
  completeOccurrence,
  skipOccurrence,
  completeTransaction,
  skipTransaction,
  revertToProjected,
  addTransactionWithBalance,
  updateManualTransactionWithBalance,
  deleteTransactionWithBalance,
  updateTransaction,
  getTransaction,
  patchIncomeSourceOverride,
  patchExpenseRuleOverride,
  LedgerOwnershipError,
} from "@/lib/firebase/firestore";
import type { OccurrenceBase } from "@/lib/firebase/firestore";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { parseDate } from "@/lib/utils/dateUtils";

/**
 * The write path of the financial context, one function per user gesture.
 *
 * Every gesture that changes money resolves to ONE ledger transaction (see
 * `lib/firebase/firestore/ledger.ts`): the stored row, the realized balance, the
 * loan / card / installment progress and the occurrence override change together
 * or not at all. A gesture on a projection (`proj_...` id) and a gesture on a
 * stored row go through the same planning code; the projection is first resolved
 * to the row it would become.
 */

/**
 * Helper to parse projection ID
 * Format: proj_${sourceId}::{scheduledDate}[::{occurrenceId}]
 */
function parseProjectionId(id: string): {
  sourceId: string;
  scheduledDate: string;
  occurrenceId?: string;
} {
  const keyPart = id.substring(5); // Remove "proj_" prefix
  const segments = keyPart.split("::");
  if (segments.length < 2) {
    throw new Error("Invalid projection ID format");
  }
  const [sourceId, scheduledDate, occurrenceId] = segments;
  return { sourceId, scheduledDate, occurrenceId };
}

/**
 * Find source from income sources and expense rules
 */
function findSource(
  sourceId: string,
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[]
): { source: IncomeSource | ExpenseRule; isIncome: boolean } | null {
  const incomeSource = incomeSources.find((s) => s.id === sourceId);
  const expenseRule = expenseRules.find((r) => r.id === sourceId);
  const source = incomeSource || expenseRule;

  if (!source) {
    return null;
  }

  return { source, isIncome: !!incomeSource };
}

interface ResolvedOccurrence {
  base: OccurrenceBase;
  /** The occurrence id carried by the projection id, if it had one. */
  parsedOccurrenceId?: string;
  source: IncomeSource | ExpenseRule;
  isIncome: boolean;
}

/**
 * Resolve a `proj_` id to the stored row it becomes. The projection is regenerated
 * from its rule so the row records what the user was LOOKING AT: the amortized
 * payment of a loan, the scheduled payment of a card, an amount override, and the
 * payment breakdown (R6: the stored-row and the projection gestures used to record
 * different things for the same occurrence).
 */
function resolveOccurrence(
  id: string,
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[]
): ResolvedOccurrence {
  const { sourceId, scheduledDate, occurrenceId: parsedOccurrenceId } = parseProjectionId(id);

  const sourceInfo = findSource(sourceId, incomeSources, expenseRules);
  if (!sourceInfo) {
    throw new Error(`Source not found for projection. ID: ${sourceId}`);
  }
  const { source, isIncome } = sourceInfo;

  const occurrenceId =
    parsedOccurrenceId ||
    generateOccurrenceId(
      source.id,
      source.frequency,
      parseDate(scheduledDate),
      source.startDate,
      source.scheduleConfig
    );

  let projection: ReturnType<typeof generateProjections>[number] | undefined;
  try {
    const day = parseDate(scheduledDate);
    const candidates = generateProjections(
      isIncome ? [source as IncomeSource] : [],
      isIncome ? [] : [source as ExpenseRule],
      day,
      day
    ).filter((p) => p.sourceId === source.id && p.scheduledDate === scheduledDate);
    projection =
      candidates.find((p) => p.occurrenceId === occurrenceId) ??
      (parsedOccurrenceId ? undefined : candidates.length === 1 ? candidates[0] : undefined);
  } catch {
    projection = undefined; // a rule the engine cannot expand: fall back to its stored amount
  }

  const overrideAmount = source.occurrenceOverrides?.[occurrenceId]?.amount;
  const base: OccurrenceBase = {
    name: source.name,
    type: isIncome ? "income" : "expense",
    category: source.category,
    sourceType: isIncome ? "income_source" : "expense_rule",
    sourceId: source.id,
    projectedAmount: projection?.projectedAmount ?? overrideAmount ?? source.amount,
    ...(projection?.paymentBreakdown ? { paymentBreakdown: projection.paymentBreakdown } : {}),
    scheduledDate,
    occurrenceId,
  };
  return { base, parsedOccurrenceId, source, isIncome };
}

/** Refuse to act on a document owned by someone else (a stale modal after a user switch). */
async function assertOwnedBy(id: string, userId: string): Promise<Transaction> {
  const existing = await getTransaction(id);
  if (!existing) throw new Error("Transaction not found");
  if (existing.userId && existing.userId !== userId) throw new LedgerOwnershipError();
  return existing;
}

/**
 * Mark transaction as complete
 * Handles both projected and stored transactions
 */
export async function markTransactionCompleteAction(
  id: string,
  data: CompleteTransactionData,
  userId: string,
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[]
): Promise<void> {
  if (id.startsWith("proj_")) {
    const { base, parsedOccurrenceId } = resolveOccurrence(id, incomeSources, expenseRules);
    // Remove any override now that the occurrence is realized
    await completeOccurrence(userId, base, data, { removeOverride: !!parsedOccurrenceId });
  } else {
    await completeTransaction(id, data.actualAmount, data.actualDate, data.notes, userId);
  }
}

/**
 * Mark transaction as skipped
 * Handles both projected and stored transactions
 */
export async function markTransactionSkippedAction(
  id: string,
  notes: string | undefined,
  userId: string,
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[]
): Promise<void> {
  if (id.startsWith("proj_")) {
    const { base, parsedOccurrenceId } = resolveOccurrence(id, incomeSources, expenseRules);
    await skipOccurrence(userId, base, notes, { removeOverride: !!parsedOccurrenceId });
  } else {
    await skipTransaction(id, notes, userId);
  }
}

/**
 * Reschedule transaction (projected or stored)
 */
export async function rescheduleTransactionAction(
  id: string,
  newDate: string,
  userId: string,
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[]
): Promise<void> {
  if (id.startsWith("proj_")) {
    const { base, source, isIncome } = resolveOccurrence(id, incomeSources, expenseRules);
    // Only the date changes: an amount or note override the user set survives the drag
    // (UI-LIFE-26, E2E-CAL-01).
    const patch = { scheduledDate: newDate };
    if (isIncome) {
      await patchIncomeSourceOverride(source.id, base.occurrenceId, patch);
    } else {
      await patchExpenseRuleOverride(source.id, base.occurrenceId, patch);
    }
    return;
  }

  // Stored transaction: update scheduledDate (and actualDate if completed)
  const existing = await assertOwnedBy(id, userId);

  const sourceInfo =
    existing.sourceId && findSource(existing.sourceId, incomeSources, expenseRules);

  const occurrenceId =
    existing.occurrenceId && existing.occurrenceId.length > 0
      ? existing.occurrenceId
      : existing.sourceId && sourceInfo
        ? generateOccurrenceId(
            sourceInfo.source.id,
            sourceInfo.source.frequency,
            parseDate(existing.scheduledDate),
            sourceInfo.source.startDate,
            sourceInfo.source.scheduleConfig
          )
        : existing.occurrenceId;

  const updates: Partial<Transaction> = {
    scheduledDate: newDate,
    occurrenceId,
  };

  if (existing.status === "completed" || existing.actualDate) {
    updates.actualDate = newDate;
  }

  await updateTransaction(id, updates);
}

/**
 * Add manual transaction. A row created as completed moves the balance in the same commit.
 */
export async function addManualTransactionAction(
  transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">,
  userId: string
): Promise<Transaction> {
  return addTransactionWithBalance(userId, transaction);
}

/**
 * Update manual transaction
 * The balance follows the row's before/after contribution (type flips, amount and
 * status changes all included), in one commit with the row write.
 */
export async function updateManualTransactionAction(
  id: string,
  updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">>,
  userId: string
): Promise<void> {
  await updateManualTransactionWithBalance(id, updates, userId);
}

/**
 * Remove transaction
 * A completed row takes its balance contribution (and debt progress) with it.
 * Can only delete stored transactions, not projections
 */
export async function removeTransactionAction(id: string, userId: string): Promise<void> {
  if (id.startsWith("proj_")) {
    throw new Error("Cannot delete projected transactions");
  }
  await deleteTransactionWithBalance(id, userId);
}

/**
 * Revert a stored transaction back to projected status.
 * Deletes the stored transaction, reverses its balance and debt progress, and
 * preserves a custom date as an override: all in one commit.
 */
export async function revertTransactionToProjectedAction(
  id: string,
  userId?: string
): Promise<void> {
  // Cannot revert projected transactions (they're already projected!)
  if (id.startsWith("proj_")) {
    throw new Error("Transaction is already projected");
  }
  await revertToProjected(id, userId);
}
