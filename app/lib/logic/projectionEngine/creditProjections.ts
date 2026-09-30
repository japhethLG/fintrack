/**
 * Credit card payment projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { parseDate } from "@/lib/utils/dateUtils";
import { buildPayoffSchedule } from "../creditCardCalculator/payoffCalculator";
import { adjustForWeekend } from "./dateUtils";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

type ProjectedTransaction = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

const pad = (n: number): string => String(n).padStart(2, "0");

/** Date of `day` in month `monthIndex` (0-based, may overflow the year), clamped to that month's length. */
const dueDateInMonth = (year: number, monthIndex: number, day: number): Date => {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return parseDate(`${y}-${pad(m + 1)}-${pad(Math.min(day, lastDay))}`);
};

/** A usable day of month, 1-31; anything else falls back to `fallback`. */
const usableDay = (day: number, fallback: number): number =>
  Number.isFinite(day) && day >= 1 ? Math.min(31, Math.floor(day)) : fallback;

/**
 * Generate projected credit card payment transactions
 *
 * The payoff schedule is built once for the whole life of the card (up to the
 * 600-month horizon) and then filtered to the window, so `paymentNumber` and
 * `totalPayments` do not depend on the viewport. Bills keep coming for as long
 * as the window asks, including for a card whose payment never covers its
 * interest. Payment `n` is due on `dueDate` of month `firstMonth + n - 1`
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

  const startDateParsed = parseDate(rule.startDate);
  const dueDay = usableDay(creditConfig.dueDate, startDateParsed.getDate());

  // First payment: the due day within the start month (clamped), or next month's if already past
  let firstYear = startDateParsed.getFullYear();
  let firstMonth = startDateParsed.getMonth();
  if (dueDateInMonth(firstYear, firstMonth, dueDay) < startDateParsed) {
    firstMonth += 1;
    firstYear += Math.floor(firstMonth / 12);
    firstMonth %= 12;
  }

  const schedule = buildPayoffSchedule(creditConfig, dueDateInMonth(firstYear, firstMonth, dueDay));
  if (schedule.length === 0) return [];

  // A card that never pays off has no known number of payments
  const last = schedule[schedule.length - 1];
  const totalPayments = last.remainingBalance < 0.01 ? schedule.length : 0;
  const adjustment = rule.weekendAdjustment === "none" ? undefined : rule.weekendAdjustment;

  return schedule.flatMap((step) => {
    // A zero payment is no bill (e.g. both minimum-payment fields left blank)
    if (!(step.payment >= 0.005)) return [];

    const logicalDate = dueDateInMonth(firstYear, firstMonth + step.month - 1, dueDay);
    const paymentDate = adjustment ? adjustForWeekend(logicalDate, adjustment) : logicalDate;
    // Filter on the date that is actually emitted
    if (paymentDate < viewStartDate || paymentDate > viewEndDate) return [];

    // The id names the logical month, so a weekend shift never changes which bill this is
    const occurrenceId = generateOccurrenceId(
      rule.id,
      rule.frequency === "one-time" ? "monthly" : rule.frequency,
      logicalDate,
      rule.startDate,
      rule.scheduleConfig
    );
    const override = rule.occurrenceOverrides?.[occurrenceId];

    const transaction = createProjectedTransaction(
      { ...rule, amount: step.payment },
      paymentDate,
      "expense",
      "expense_rule",
      {
        principalPaid: step.principal,
        interestPaid: step.interest,
        remainingBalance: step.remainingBalance,
        paymentNumber: step.month,
        totalPayments,
      },
      occurrenceId,
      override
    );
    return transaction ? [transaction] : [];
  });
};
