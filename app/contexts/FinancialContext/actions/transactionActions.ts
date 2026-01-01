import {
  Transaction,
  CompleteTransactionData,
  IncomeSource,
  ExpenseRule,
  OccurrenceOverride,
} from "@/lib/types";
import {
  addTransaction,
  completeTransaction,
  skipTransaction,
  revertToProjected,
  deleteTransaction,
  updateExpenseRule,
  adjustUserBalance,
  updateTransaction,
  getTransaction,
  getIncomeSource,
  getExpenseRule,
  setIncomeSourceOverride,
  removeIncomeSourceOverride,
  setExpenseRuleOverride,
  removeExpenseRuleOverride,
} from "@/lib/firebase/firestore";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { parseDate } from "@/lib/utils/dateUtils";

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
  // Check if this is a projected transaction
  if (id.startsWith("proj_")) {
    const { sourceId, scheduledDate, occurrenceId: parsedOccurrenceId } = parseProjectionId(id);

    const sourceInfo = findSource(sourceId, incomeSources, expenseRules);
    if (!sourceInfo) {
      throw new Error(`Source not found for projection. ID: ${sourceId}`);
    }

    const { source, isIncome } = sourceInfo;
    const sourceType = isIncome ? "income_source" : "expense_rule";

    // Create the stored transaction as completed
    await addTransaction(userId, {
      name: source.name,
      type: isIncome ? "income" : "expense",
      category: source.category,
      sourceType,
      sourceId: source.id,
      projectedAmount: source.amount,
      actualAmount: data.actualAmount,
      scheduledDate,
      actualDate: data.actualDate || scheduledDate,
      status: "completed",
      notes: data.notes,
      occurrenceId:
        parsedOccurrenceId ||
        generateOccurrenceId(
          source.id,
          source.frequency,
          parseDate(scheduledDate),
          source.startDate,
          source.scheduleConfig
        ),
    });

    // Update user balance
    const delta = isIncome ? data.actualAmount : -data.actualAmount;
    await adjustUserBalance(userId, delta);

    // Remove any override now that occurrence is realized
    const overrideRemover = isIncome ? removeIncomeSourceOverride : removeExpenseRuleOverride;
    if (parsedOccurrenceId) {
      await overrideRemover(source.id, parsedOccurrenceId);
    }

    // Update source tracking if applicable (loan/installment)
    if (!isIncome) {
      const expenseRule = source as ExpenseRule;
      if (expenseRule.loanConfig) {
        await updateExpenseRule(source.id, {
          loanConfig: {
            ...expenseRule.loanConfig,
            paymentsMade: expenseRule.loanConfig.paymentsMade + 1,
          },
        });
      } else if (expenseRule.installmentConfig) {
        await updateExpenseRule(source.id, {
          installmentConfig: {
            ...expenseRule.installmentConfig,
            installmentsPaid: expenseRule.installmentConfig.installmentsPaid + 1,
          },
        });
      }
    }
  } else {
    // This is a stored transaction - use normal completion flow
    await completeTransaction(id, data.actualAmount, data.actualDate, data.notes);
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
  // Check if this is a projected transaction
  if (id.startsWith("proj_")) {
    const { sourceId, scheduledDate, occurrenceId: parsedOccurrenceId } = parseProjectionId(id);

    const sourceInfo = findSource(sourceId, incomeSources, expenseRules);
    if (!sourceInfo) {
      throw new Error(`Source not found for projection. ID: ${sourceId}`);
    }

    const { source, isIncome } = sourceInfo;

    // Create stored transaction as skipped
    await addTransaction(userId, {
      name: source.name,
      type: isIncome ? "income" : "expense",
      category: source.category,
      sourceType: isIncome ? "income_source" : "expense_rule",
      sourceId: source.id,
      projectedAmount: source.amount,
      scheduledDate,
      status: "skipped",
      notes,
      occurrenceId:
        parsedOccurrenceId ||
        generateOccurrenceId(
          source.id,
          source.frequency,
          parseDate(scheduledDate),
          source.startDate,
          source.scheduleConfig
        ),
    });

    // Remove any override now that occurrence is realized
    const overrideRemover = isIncome ? removeIncomeSourceOverride : removeExpenseRuleOverride;
    if (parsedOccurrenceId) {
      await overrideRemover(source.id, parsedOccurrenceId);
    }
  } else {
    await skipTransaction(id, notes);
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

    const override: OccurrenceOverride = { scheduledDate: newDate };
    if (isIncome) {
      await setIncomeSourceOverride(source.id, occurrenceId, override);
    } else {
      await setExpenseRuleOverride(source.id, occurrenceId, override);
    }
    return;
  }

  // Stored transaction: update scheduledDate (and actualDate if completed)
  const existing = await getTransaction(id);
  if (!existing) {
    throw new Error("Transaction not found");
  }

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
 * Add manual transaction
 */
export async function addManualTransactionAction(
  transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">,
  userId: string
): Promise<Transaction> {
  return addTransaction(userId, transaction);
}

/**
 * Update manual transaction
 * Handles balance adjustments during status and amount changes
 */
export async function updateManualTransactionAction(
  id: string,
  updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">>,
  userId: string
): Promise<void> {
  // Get existing transaction
  const existing = await getTransaction(id);
  if (!existing) {
    throw new Error("Transaction not found");
  }

  // Validate this is a manual transaction
  if (existing.sourceType !== "manual") {
    throw new Error("This action is only for manual transactions");
  }

  // Determine old and new state
  const wasCompleted = existing.status === "completed";
  const nowCompleted = (updates.status ?? existing.status) === "completed";

  const oldAmount = existing.actualAmount ?? existing.projectedAmount;
  const newAmount = updates.actualAmount ?? updates.projectedAmount ?? oldAmount;

  // Handle balance adjustments based on status transitions
  if (wasCompleted && !nowCompleted) {
    // Completed → Projected/Skipped: Reverse the old balance impact
    const reversalDelta = existing.type === "income" ? -oldAmount : oldAmount;
    await adjustUserBalance(userId, reversalDelta);
  } else if (!wasCompleted && nowCompleted) {
    // Projected/Skipped → Completed: Apply balance impact
    const delta = existing.type === "income" ? newAmount : -newAmount;
    await adjustUserBalance(userId, delta);
  } else if (wasCompleted && nowCompleted && oldAmount !== newAmount) {
    // Completed → Completed with amount change: Adjust the difference
    const oldDelta = existing.type === "income" ? oldAmount : -oldAmount;
    const newDelta = existing.type === "income" ? newAmount : -newAmount;
    const adjustmentDelta = newDelta - oldDelta;
    await adjustUserBalance(userId, adjustmentDelta);
  }

  // Apply the updates
  await updateTransaction(id, updates);
}

/**
 * Remove transaction
 * Handles balance reversal for manual transactions
 * Can only delete stored transactions, not projections
 */
export async function removeTransactionAction(id: string, userId: string): Promise<void> {
  if (id.startsWith("proj_")) {
    throw new Error("Cannot delete projected transactions");
  }

  // Get the transaction to check if balance reversal is needed
  const transaction = await getTransaction(id);
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  // Reverse balance if this is a completed manual transaction
  if (transaction.sourceType === "manual" && transaction.status === "completed") {
    const amount = transaction.actualAmount ?? transaction.projectedAmount;
    const reversalDelta = transaction.type === "income" ? -amount : amount;
    await adjustUserBalance(userId, reversalDelta);
  }

  await deleteTransaction(id);
}

/**
 * Revert a stored transaction back to projected status.
 * Deletes the stored transaction and optionally creates an override to preserve the scheduled date.
 */
export async function revertTransactionToProjectedAction(id: string): Promise<void> {
  // Cannot revert projected transactions (they're already projected!)
  if (id.startsWith("proj_")) {
    throw new Error("Transaction is already projected");
  }

  // Call Firestore function which handles balance reversal and deletion
  const revertData = await revertToProjected(id);

  if (!revertData) {
    return; // Transaction was reverted but no date preservation needed
  }

  // Check if we need to create an override to preserve the scheduled date
  // We need to compare the stored transaction's date with what the source pattern would generate
  const { scheduledDate, sourceId, sourceType, occurrenceId } = revertData;

  if (!occurrenceId) {
    return; // Can't create override without occurrence ID
  }

  // Get the source to check if the date differs from the pattern
  const source =
    sourceType === "income_source"
      ? await getIncomeSource(sourceId)
      : await getExpenseRule(sourceId);

  if (!source) {
    return; // Source was deleted, can't create override
  }

  // Calculate what the original pattern date would be for this occurrence
  // The occurrenceId encodes the logical period (e.g., "sourceId_2025-01" for monthly)
  // We compare the stored scheduledDate with what would be generated
  // If they differ, we create an override to preserve the user's custom date

  // Generate the expected date for this occurrence
  const expectedDate = getExpectedDateFromOccurrenceId(occurrenceId, source);

  if (expectedDate && scheduledDate !== expectedDate) {
    // User had moved this transaction - preserve the custom date
    const override: OccurrenceOverride = { scheduledDate };

    if (sourceType === "income_source") {
      await setIncomeSourceOverride(sourceId, occurrenceId, override);
    } else {
      await setExpenseRuleOverride(sourceId, occurrenceId, override);
    }
  }
}

/**
 * Helper to extract expected date from occurrence ID
 * Returns null if we can't determine (fallback to no override)
 */
function getExpectedDateFromOccurrenceId(
  occurrenceId: string,
  source: { startDate: string; frequency: string; scheduleConfig?: { specificDays?: number[] } }
): string | null {
  // Occurrence ID formats:
  // - one-time: "sourceId_once"
  // - daily: "sourceId_YYYY-MM-DD"
  // - weekly: "sourceId_WN" (week number)
  // - bi-weekly: "sourceId_BWN" (occurrence number)
  // - semi-monthly: "sourceId_YYYY-MM-index"
  // - monthly: "sourceId_YYYY-MM"
  // - quarterly: "sourceId_YYYY-QN"
  // - yearly: "sourceId_YYYY"

  // For monthly, we can reconstruct the expected date
  const monthlyMatch = occurrenceId.match(/_([0-9]{4})-([0-9]{2})$/);
  if (monthlyMatch) {
    const [, year, month] = monthlyMatch;
    const startDay = parseInt(source.startDate.split("-")[2], 10);
    const lastDayOfMonth = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
    const day = Math.min(startDay, lastDayOfMonth);
    return `${year}-${month}-${day.toString().padStart(2, "0")}`;
  }

  // For daily, the date is in the occurrence ID
  const dailyMatch = occurrenceId.match(/_([0-9]{4}-[0-9]{2}-[0-9]{2})$/);
  if (dailyMatch) {
    return dailyMatch[1];
  }

  // For other frequencies, we can't easily determine - safer to not create override
  // This means weekly/bi-weekly/semi-monthly rescheduled dates won't be preserved
  // This is acceptable as an initial implementation
  return null;
}
