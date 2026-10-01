/**
 * Credit card payment projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { formatDate } from "@/lib/utils/dateUtils";
import { buildPayoffSchedule } from "../creditCardCalculator/payoffCalculator";
import { adjustForWeekend, byScheduledDate, windowFilter } from "./dateUtils";
import { debtPaymentsMade, unpaidSlots } from "./debtSlots";
import { centsSchedule, createProjectedTransaction } from "./transactionFactory";

type ProjectedTransaction = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

/**
 * Generate projected credit card payment transactions
 *
 * The payoff schedule is built once for the whole life of the card (up to the
 * 600-month horizon) and then filtered to the window, so `paymentNumber` and
 * `totalPayments` do not depend on the viewport. Bills keep coming for as long
 * as the window asks, including for a card whose payment never covers its
 * interest. The payments fall on the card's unpaid slots (see debtSlots.ts): slot k is `dueDate` of month `firstMonth + k`
 * (clamped to that month's last day), moved for weekends when the rule asks.
 *
 * @param rule - Expense rule with credit card configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected credit card payment transactions
 */
export const generateCreditProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): ProjectedTransaction[] => {
  if (!rule.creditConfig) return [];

  const { creditConfig } = rule;

  if (!Number.isFinite(creditConfig.currentBalance) || creditConfig.currentBalance <= 0) return [];

  // The schedule starts from the CURRENT balance, so it covers only the payments still to make; they fall
  // on the card's UNPAID monthly due dates, earliest first (see debtSlots.ts). `paymentNumber` stays absolute.
  const made = debtPaymentsMade(rule);
  const [firstUnpaid] = unpaidSlots(rule, 1);
  const schedule = buildPayoffSchedule(creditConfig, firstUnpaid.date);
  if (schedule.length === 0) return [];

  // A card that never pays off has no known number of payments
  const last = schedule[schedule.length - 1];
  const totalPayments = last.remainingBalance < 0.01 ? made + schedule.length : 0;
  const adjustment = rule.weekendAdjustment === "none" ? undefined : rule.weekendAdjustment;
  const inWindow = windowFilter(viewStartDate, viewEndDate);
  const slots = unpaidSlots(rule, schedule.length);

  const inCents = centsSchedule(schedule, creditConfig.currentBalance);

  return schedule.flatMap((step, index) => {
    // A zero payment is no bill (e.g. both minimum-payment fields left blank)
    if (!(step.payment >= 0.005)) return [];

    const slot = slots[step.month - 1];
    const logicalDate = slot.date;
    const paymentDate = adjustment ? adjustForWeekend(logicalDate, adjustment) : logicalDate;

    // The id names the logical month, so a weekend shift never changes which bill this is
    const occurrenceId = slot.id;
    const override = rule.occurrenceOverrides?.[occurrenceId];
    // Filter on the date that is actually shown: a dragged bill belongs to the window it was dropped in
    if (!inWindow(override?.scheduledDate ?? formatDate(paymentDate))) return [];

    const { amount, ...cents } = inCents[index];
    const transaction = createProjectedTransaction(
      { ...rule, amount },
      paymentDate,
      "expense",
      "expense_rule",
      { ...cents, paymentNumber: slot.index + 1, totalPayments },
      occurrenceId,
      override
    );
    return transaction ? [transaction] : [];
  }).sort(byScheduledDate);
};
