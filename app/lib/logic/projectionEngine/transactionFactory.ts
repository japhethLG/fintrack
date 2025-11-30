/**
 * Factory functions for creating projected transactions
 */

import {
  IncomeSource,
  ExpenseRule,
  Transaction,
  TransactionType,
  PaymentBreakdown,
} from "@/lib/types";
import { formatDate } from "@/lib/utils/dateUtils";

/**
 * Create a projected transaction from a source rule
 * @param source - Income source or expense rule
 * @param date - Date for the transaction
 * @param type - Transaction type (income or expense)
 * @param sourceType - Source type identifier
 * @param paymentBreakdown - Optional payment breakdown for loans/credit cards
 */
export const createProjectedTransaction = (
  source: IncomeSource | ExpenseRule,
  date: Date,
  type: TransactionType,
  sourceType: "income_source" | "expense_rule",
  paymentBreakdown?: PaymentBreakdown
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> => {
  const amount = paymentBreakdown?.principalPaid
    ? paymentBreakdown.principalPaid + paymentBreakdown.interestPaid
    : source.amount;

  return {
    name: source.name,
    type,
    category: source.category,
    sourceType,
    sourceId: source.id,
    projectedAmount: amount,
    scheduledDate: formatDate(date),
    status: "projected",
    paymentBreakdown,
  };
};
