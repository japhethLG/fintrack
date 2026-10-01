/**
 * Installment payment projection generation
 */

import { ExpenseRule, InstallmentConfig, Transaction } from "@/lib/types";
import { formatDate, parseDate } from "@/lib/utils/dateUtils";
import { adjustForWeekend, byScheduledDate, monthlyPaymentDate, windowFilter } from "./dateUtils";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

type ProjectedTransaction = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

const round2 = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
};

/**
 * The amount of every installment of the plan, in whole cents.
 *
 * Every installment but the last is the plan's stated amount rounded to the
 * cent; the LAST one absorbs the rounding residual so the plan sums to exactly
 * its total (1,000 over 7 is six of 142.86 and one of 142.84). The total is the
 * stated `totalAmount` for a 0% plan, or `installmentAmount x count` for a plan
 * with interest (that amount already includes the charge). When the stated
 * amount disagrees with the total by more than rounding, it is trusted as
 * stated instead of forcing a wild last installment.
 *
 * Returns [] when the count is not a whole number >= 1.
 */
export const buildInstallmentAmounts = (config: InstallmentConfig): number[] => {
  const count = Math.floor(config.installmentCount);
  if (!Number.isFinite(count) || count < 1) return [];

  const stated = Number.isFinite(config.installmentAmount) && config.installmentAmount > 0
    ? config.installmentAmount
    : undefined;
  const hasTotal = Number.isFinite(config.totalAmount) && config.totalAmount > 0;
  const amount = round2(stated ?? (hasTotal ? config.totalAmount / count : 0));

  const amounts: number[] = Array(count).fill(amount);

  const payable = config.hasInterest || !hasTotal ? amount * count : config.totalAmount;
  const residual = round2(payable) - round2(amount * count);
  if (Math.abs(residual) <= 0.005 * count + 0.005) {
    amounts[count - 1] = round2(amount + residual);
  }
  return amounts;
};

/**
 * Generate projected installment payment transactions
 *
 * Installment `i` (0-based) is due `startDate + i` months, always computed from
 * the original anchor, so a Jan 31 plan bills Jan 31, Feb 28, Mar 31 ... and
 * never drifts to the 28th. When the rule has a `scheduleConfig.dayOfMonth` the
 * installments fall on that day instead (see `monthlyPaymentDate`). The occurrence id names the logical month (the
 * weekend shift only moves the date) and a `one-time` frequency is treated as
 * monthly for identity, so no two installments ever share an id.
 *
 * @param rule - Expense rule with installment configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected installment payment transactions
 */
export const generateInstallmentProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): ProjectedTransaction[] => {
  if (!rule.installmentConfig) return [];

  const { installmentConfig } = rule;

  const amounts = buildInstallmentAmounts(installmentConfig);
  const count = amounts.length;
  if (count === 0) return [];

  const paid = Math.max(0, Math.floor(Number.isFinite(installmentConfig.installmentsPaid) ? installmentConfig.installmentsPaid : 0));
  if (count - paid <= 0) return [];

  const anchor = parseDate(rule.startDate);
  const adjustment = rule.weekendAdjustment === "none" ? undefined : rule.weekendAdjustment;
  const projections: ProjectedTransaction[] = [];
  const inWindow = windowFilter(viewStartDate, viewEndDate);

  for (let i = paid; i < count; i++) {
    const logicalDate = monthlyPaymentDate(anchor, rule.scheduleConfig?.dayOfMonth, i);
    const emittedDate = adjustment ? adjustForWeekend(logicalDate, adjustment) : logicalDate;

    const paymentNumber = i + 1;
    const occurrenceId = generateOccurrenceId(
      rule.id,
      rule.frequency === "one-time" ? "monthly" : rule.frequency,
      logicalDate,
      rule.startDate,
      rule.scheduleConfig
    );
    const override = rule.occurrenceOverrides?.[occurrenceId];
    // The window applies to where the row is shown (a dragged installment moves with its override)
    if (!inWindow(override?.scheduledDate ?? formatDate(emittedDate))) continue;

    // what is still to be paid after this installment, exact to the cent
    const remainingBalance = round2(amounts.slice(i + 1).reduce((sum, a) => sum + a, 0));

    const transaction = createProjectedTransaction(
      { ...rule, amount: amounts[i] },
      emittedDate,
      "expense",
      "expense_rule",
      {
        principalPaid: amounts[i],
        interestPaid: 0,
        remainingBalance,
        paymentNumber,
        totalPayments: count,
      },
      occurrenceId,
      override
    );

    if (transaction) {
      projections.push(transaction);
    }
  }

  return projections.sort(byScheduledDate);
};
