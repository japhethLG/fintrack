import { Transaction, CompleteTransactionData, IncomeSource, ExpenseRule } from "@/lib/types";
import {
  addTransaction,
  completeTransaction,
  skipTransaction,
  deleteTransaction,
  updateExpenseRule,
  adjustUserBalance,
} from "@/lib/firebase/firestore";

/**
 * Helper to parse projection ID
 * Format: proj_${sourceId}-${scheduledDate}
 */
function parseProjectionId(id: string): { sourceId: string; scheduledDate: string } {
  const keyPart = id.substring(5); // Remove "proj_" prefix
  if (keyPart.length < 12) {
    throw new Error("Invalid projection ID format");
  }
  // Date is always last 10 characters (YYYY-MM-DD)
  const scheduledDate = keyPart.substring(keyPart.length - 10);
  // Source ID is everything before the last dash
  const sourceId = keyPart.substring(0, keyPart.length - 11);

  return { sourceId, scheduledDate };
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
    const { sourceId, scheduledDate } = parseProjectionId(id);

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
    const { sourceId, scheduledDate } = parseProjectionId(id);

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
    });
  } else {
    await skipTransaction(id, notes);
  }
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

