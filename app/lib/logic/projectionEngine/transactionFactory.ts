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
import { roundCents } from "../balanceCalculator/ledgerMath";

/** One payment of a debt schedule, in whole cents. */
export interface CentsStep {
  amount: number;
  principalPaid: number;
  interestPaid: number;
  remainingBalance: number;
}

/**
 * A debt schedule in whole cents (MANUAL-L2/L3): nobody pays 4707.347222.... Each payment and its interest
 * are rounded to the cent and the principal is what is left of the payment, against a running balance
 * kept in cents, so principal + interest == payment exactly and the principals sum to the opening balance.
 * A schedule that pays off has its last payment trued up to whatever (whole-cent) balance is left. The
 * amortization itself keeps full precision; only what is shown and recorded is rounded.
 */
export const centsSchedule = (
  steps: readonly { payment: number; interest: number; remainingBalance: number }[],
  openingBalance: number
): CentsStep[] => {
  let balance = roundCents(openingBalance);
  const paysOff = steps.length > 0 && steps[steps.length - 1].remainingBalance < 0.005;
  return steps.map((step, index) => {
    const interestPaid = roundCents(step.interest);
    let amount = roundCents(step.payment);
    let principalPaid = roundCents(amount - interestPaid);
    if (paysOff && index === steps.length - 1) {
      principalPaid = balance;
      amount = roundCents(principalPaid + interestPaid);
    }
    balance = roundCents(balance - principalPaid);
    return { amount, principalPaid, interestPaid, remainingBalance: balance };
  });
};

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
      ? roundCents(paymentBreakdown.principalPaid + paymentBreakdown.interestPaid)
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
