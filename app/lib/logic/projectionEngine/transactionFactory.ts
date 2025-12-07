/**
 * Factory functions for creating projected transactions
 */

import {
  IncomeSource,
  ExpenseRule,
  Transaction,
  TransactionType,
  PaymentBreakdown,
  OccurrenceOverride,
} from "@/lib/types";
import { formatDate } from "@/lib/utils/dateUtils";

/**
 * Create a projected transaction from a source rule
 * @param source - Income source or expense rule
 * @param date - Date for the transaction
 * @param type - Transaction type (income or expense)
 * @param sourceType - Source type identifier
 * @param paymentBreakdown - Optional payment breakdown for loans/credit cards
 * @param occurrenceId - Stable identifier for the logical occurrence
 * @param override - Optional occurrence-level override (date/amount/skip)
 */
export const createProjectedTransaction = (
  source: IncomeSource | ExpenseRule,
  date: Date,
  type: TransactionType,
  sourceType: "income_source" | "expense_rule",
  paymentBreakdown?: PaymentBreakdown,
  occurrenceId?: string,
  override?: OccurrenceOverride
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> | null => {
  // Skip projections explicitly marked as skipped
  if (override?.skipped) return null;

  const amount =
    override?.amount ??
    (paymentBreakdown?.principalPaid
      ? paymentBreakdown.principalPaid + paymentBreakdown.interestPaid
      : source.amount);

  const scheduledDate = override?.scheduledDate ?? formatDate(date);

  return {
    name: source.name,
    type,
    category: source.category,
    sourceType,
    sourceId: source.id,
    projectedAmount: amount,
    scheduledDate,
    status: "projected",
    paymentBreakdown,
    occurrenceId,
    notes: override?.notes ?? source.notes,
  };
};
