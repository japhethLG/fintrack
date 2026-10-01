/**
 * Loan payment projection generation
 */

import { ExpenseRule, LoanConfig, Transaction } from "@/lib/types";
import { formatDate, parseDate } from "@/lib/utils/dateUtils";
import { AmortizationStep, calculateAmortizationSchedule } from "../amortization";
import { adjustForWeekend, byScheduledDate, windowFilter } from "./dateUtils";
import { DebtSlot, unpaidSlots } from "./debtSlots";
import { centsSchedule, createProjectedTransaction } from "./transactionFactory";

type ProjectedTransaction = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

/** Below this a balance is treated as repaid (half a cent). */
const PAID_OFF_EPSILON = 0.005;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/**
 * Where a loan stands, judged from its stored progress.
 * - `paid_off`: nothing is owed (balance <= 0), whatever the payment counter says.
 * - `past_term_balance_owed`: every scheduled payment is counted but money is
 *   still owed. The loan must not vanish from the calendar while that is true.
 * - `active`: scheduled payments remain.
 * - `invalid`: the term is not a whole number of months >= 1; nothing can be scheduled.
 */
export type LoanStatus = "active" | "paid_off" | "past_term_balance_owed" | "invalid";

export const getLoanStatus = (loanConfig: LoanConfig): LoanStatus => {
  const balance = finiteOr(loanConfig.currentBalance, 0);
  if (balance <= PAID_OFF_EPSILON) return "paid_off";
  const made = Math.max(0, Math.floor(finiteOr(loanConfig.paymentsMade, 0)));
  const term = Math.floor(finiteOr(loanConfig.termMonths, 0));
  if (term < 1) return "invalid"; // a loan with no term cannot be scheduled
  return made >= term ? "past_term_balance_owed" : "active";
};

/**
 * The remaining payment schedule of a loan, with absolute payment numbers.
 *
 * - The schedule starts from `currentBalance` over the remaining term
 *   (`termMonths - paymentsMade`). Its payments fall on the loan's UNPAID
 *   slots, earliest first (see `debtSlots.ts`): slot k is the ORIGINAL anchor
 *   (`rule.startDate`) advanced by k months, on the rule's
 *   `scheduleConfig.dayOfMonth` when it has one (see `monthlyPaymentDate`).
 *   With payments made in order that is "after the first `paymentsMade`".
 * - An amortized loan pays its stored `monthlyPayment` (the contract); flat and
 *   reducing-balance loans pay what their formula says.
 * - Past the term with a balance still owed, one payment for the outstanding
 *   balance plus a month of interest is reported instead of nothing.
 */
const buildRemainingSchedule = (
  rule: ExpenseRule,
  loanConfig: LoanConfig
): { steps: (AmortizationStep & { slot: DebtSlot })[]; made: number } | null => {
  const status = getLoanStatus(loanConfig);
  if (status === "paid_off" || status === "invalid") return null;

  const balance = finiteOr(loanConfig.currentBalance, 0);
  const made = Math.max(0, Math.floor(finiteOr(loanConfig.paymentsMade, 0)));
  const term = Math.floor(finiteOr(loanConfig.termMonths, 0));
  const annualRate = finiteOr(loanConfig.interestRate, 0);
  const anchor = parseDate(rule.startDate);

  if (status === "past_term_balance_owed") {
    const interest = balance * (annualRate / 100 / 12);
    const [slot] = unpaidSlots(rule, 1);
    return {
      made,
      steps: [
        {
          slot,
          date: slot.date,
          payment: balance + interest,
          principal: balance,
          interest,
          remainingBalance: 0,
        },
      ],
    };
  }

  const schedule = calculateAmortizationSchedule({
    principal: balance,
    annualRate,
    termMonths: term - made,
    monthlyPayment: loanConfig.monthlyPayment,
    startDate: anchor,
    monthOffset: made,
    calculationType: loanConfig.calculationType,
    interestBasis: loanConfig.principalAmount,
  });
  // The schedule's own dates follow the start date's day; the slots (unpaid months, on the rule's Day of
  // Month when set) decide the dates.
  const slots = unpaidSlots(rule, schedule.length);
  const steps = schedule.map((step, index) => ({ ...step, slot: slots[index], date: slots[index].date }));
  return { steps, made };
};

/**
 * Generate projected loan payment transactions with amortization
 * @param rule - Expense rule with loan configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected loan payment transactions
 */
export const generateLoanProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): ProjectedTransaction[] => {
  if (!rule.loanConfig) return [];

  const { loanConfig } = rule;
  const plan = buildRemainingSchedule(rule, loanConfig);
  if (!plan) return [];

  const { steps, made } = plan;
  const totalPayments = made + steps.length;
  const adjustment = rule.weekendAdjustment === "none" ? undefined : rule.weekendAdjustment;
  const inWindow = windowFilter(viewStartDate, viewEndDate);

  // A payment's number is its slot's absolute position in the loan and must not depend on what the
  // viewport shows; the occurrence id names the slot's logical month (the weekend shift only moves the date).
  const inCents = centsSchedule(steps, finiteOr(loanConfig.currentBalance, 0));
  return steps
    .flatMap((step, index) => {
      const paymentNumber = step.slot.index + 1;
      const occurrenceId = step.slot.id;
      const emittedDate = adjustment ? adjustForWeekend(step.date, adjustment) : step.date;
      // The window applies to where the row is SHOWN: a dragged payment (override
      // `scheduledDate`) belongs to the window it was dropped in, with its breakdown.
      const override = rule.occurrenceOverrides?.[occurrenceId];
      if (!inWindow(override?.scheduledDate ?? formatDate(emittedDate))) return [];
      const { amount, ...cents } = inCents[index];
      const transaction = createProjectedTransaction(
        { ...rule, amount },
        emittedDate,
        "expense",
        "expense_rule",
        { ...cents, paymentNumber, totalPayments },
        occurrenceId,
        override
      );
      return transaction ? [transaction] : [];
    })
    .sort(byScheduledDate);
};
