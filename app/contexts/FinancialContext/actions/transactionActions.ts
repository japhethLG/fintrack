import { Transaction, CompleteTransactionData, IncomeSource, ExpenseRule } from "@/lib/types";
import {
  addTransaction,
  completeTransaction,
  skipTransaction,
  deleteTransaction,
  updateExpenseRule,
  adjustUserBalance,
  updateTransaction,
  getTransaction,
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
        generateOccurrenceId(source.id, source.frequency, parseDate(scheduledDate), source.startDate, source.scheduleConfig),
    });

    // Update user balance
    const delta = isIncome ? data.actualAmount : -data.actualAmount;
    await adjustUserBalance(userId, delta);

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
        generateOccurrenceId(source.id, source.frequency, parseDate(scheduledDate), source.startDate, source.scheduleConfig),
    });
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

    await addTransaction(userId, {
      name: source.name,
      type: isIncome ? "income" : "expense",
      category: source.category,
      sourceType: isIncome ? "income_source" : "expense_rule",
      sourceId: source.id,
      projectedAmount: source.amount,
      scheduledDate: newDate,
      status: "pending",
      occurrenceId,
    });
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

  if (existing.status === "completed") {
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
 * Remove transaction
 * Can only delete stored transactions, not projections
 */
export async function removeTransactionAction(id: string): Promise<void> {
  if (!id.startsWith("proj_")) {
    await deleteTransaction(id);
  }
}

