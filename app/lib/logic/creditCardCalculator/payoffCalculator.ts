/**
 * Core credit card payoff calculations
 *
 * Every schedule obeys the conservation identity, row by row:
 *   remainingBalance = opening balance + cumulativeInterest - payments so far
 * A payment below the month's interest therefore GROWS the balance (the unpaid
 * interest capitalises, as it does on a real card) and is reported as negative
 * principal. Nothing is clamped, so a card caught in the minimum-payment trap is
 * shown compounding instead of sitting flat.
 */

import { addMonths } from "@/lib/utils/dateUtils";
import { getEffectivePayment } from "./paymentCalculator";
import { MonthlyBreakdown, CreditConfig } from "./types";

/** Below this the balance is treated as repaid. */
const PAID_OFF_EPSILON = 0.01;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

/** One schedule row's arithmetic, shared by the fixed and declining builders. */
const nextRow = (
  balance: number,
  monthlyRate: number,
  requestedPayment: number
): { interest: number; payment: number; principal: number; balance: number } => {
  const interest = balance * monthlyRate;
  let payment = requestedPayment;

  // Final payment: clear the balance and its interest, nothing more, and end at exactly 0
  if (payment >= balance + interest) {
    payment = balance + interest;
    return { interest, payment, principal: payment - interest, balance: 0 };
  }

  // Not clamped: if the payment does not cover the interest the balance grows.
  const principal = payment - interest;
  return { interest, payment, principal, balance: balance - principal };
};

/**
 * Calculate full payoff schedule for a credit card with FIXED payment
 * @param currentBalance - Current card balance
 * @param apr - Annual percentage rate
 * @param monthlyPayment - Fixed monthly payment amount
 * @param startDate - Start date for projection (payment `n` is `startDate + n - 1` months, from the fixed anchor)
 * @param maxMonths - Maximum months to project (default: 600 = 50 years). A card
 *   that never pays off runs to this horizon; it is not cut short.
 * @returns Array of monthly payment breakdowns
 */
export const calculateCreditCardPayoff = (
  currentBalance: number,
  apr: number,
  monthlyPayment: number,
  startDate: Date = new Date(),
  maxMonths: number = 600
): MonthlyBreakdown[] => {
  const schedule: MonthlyBreakdown[] = [];
  let balance = finiteOr(currentBalance, 0);
  const monthlyRate = finiteOr(apr, 0) / 100 / 12;
  const payment = Math.max(0, finiteOr(monthlyPayment, 0));
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;

  for (let month = 1; month <= maxMonths && balance > PAID_OFF_EPSILON; month++) {
    const row = nextRow(balance, monthlyRate, payment);
    balance = row.balance;
    cumulativeInterest += row.interest;
    cumulativePrincipal += row.principal;

    schedule.push({
      month,
      date: addMonths(startDate, month - 1),
      payment: row.payment,
      principal: row.principal,
      interest: row.interest,
      remainingBalance: balance,
      cumulativeInterest,
      cumulativePrincipal,
    });

    // Runaway growth (absurd APR over 50 years): stop rather than emit Infinity
    if (!Number.isFinite(balance)) break;
  }

  return schedule;
};

/**
 * Calculate payoff schedule with DECLINING minimum payment
 * (for minimum payment strategy where payments decrease as balance decreases)
 * @param config - Credit card configuration
 * @param startDate - Start date for projection
 * @param maxMonths - Maximum months to project (default: 600 = 50 years)
 * @returns Array of monthly payment breakdowns
 */
export const calculateDecliningMinimumPayoff = (
  config: CreditConfig,
  startDate: Date = new Date(),
  maxMonths: number = 600
): MonthlyBreakdown[] => {
  const schedule: MonthlyBreakdown[] = [];
  let balance = finiteOr(config.currentBalance, 0);
  const monthlyRate = finiteOr(config.apr, 0) / 100 / 12;
  // Blank / NaN optional inputs count as 0 rather than poisoning every row
  const percent = finiteOr(config.minimumPaymentPercent, 0);
  const floor = finiteOr(config.minimumPaymentFloor, 0);
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;

  for (let month = 1; month <= maxMonths && balance > PAID_OFF_EPSILON; month++) {
    const interest = balance * monthlyRate;

    // Recalculate minimum payment based on current balance
    const requested =
      config.minimumPaymentMethod === "percent_plus_interest"
        ? Math.max(floor, balance * (percent / 100) + interest)
        : Math.max(floor, balance * (percent / 100));

    const row = nextRow(balance, monthlyRate, Math.max(0, requested));
    balance = row.balance;
    cumulativeInterest += row.interest;
    cumulativePrincipal += row.principal;

    schedule.push({
      month,
      date: addMonths(startDate, month - 1),
      payment: row.payment,
      principal: row.principal,
      interest: row.interest,
      remainingBalance: balance,
      cumulativeInterest,
      cumulativePrincipal,
    });

    if (!Number.isFinite(balance)) break;
  }

  return schedule;
};

/**
 * Schedule for the "pay full balance" strategy: the statement balance is cleared
 * in ONE payment and, because it is paid in full by the due date, no interest is
 * charged (the card's grace period). Empty for a settled or non-finite balance.
 */
export const calculateFullBalancePayoff = (
  currentBalance: number,
  startDate: Date = new Date()
): MonthlyBreakdown[] => {
  const balance = finiteOr(currentBalance, 0);
  if (balance <= PAID_OFF_EPSILON) return [];
  return [
    {
      month: 1,
      date: new Date(startDate),
      payment: balance,
      principal: balance,
      interest: 0,
      remainingBalance: 0,
      cumulativeInterest: 0,
      cumulativePrincipal: balance,
    },
  ];
};

/**
 * The schedule a card follows under its payment strategy. `minimum` recomputes
 * the payment from the shrinking balance; `full_balance` clears the statement
 * in one payment (no interest, grace period); everything else is level.
 */
export const buildPayoffSchedule = (
  config: CreditConfig,
  startDate: Date = new Date(),
  maxMonths: number = 600
): MonthlyBreakdown[] => {
  if (config.paymentStrategy === "minimum") {
    return calculateDecliningMinimumPayoff(config, startDate, maxMonths);
  }
  if (config.paymentStrategy === "full_balance") {
    return calculateFullBalancePayoff(config.currentBalance, startDate);
  }
  return calculateCreditCardPayoff(
    config.currentBalance,
    config.apr,
    getEffectivePayment(config),
    startDate,
    maxMonths
  );
};
