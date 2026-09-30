/**
 * Loan amortization calculations
 */

import { addMonths } from "@/lib/utils/dateUtils";
import { AmortizationStep, LoanCalculationMode, LoanConfig } from "./types";

/** Safety cap when a loan has no term: 30 years of monthly payments. */
const DEFAULT_MAX_MONTHS = 360;
/** Below this the balance is treated as repaid. */
const PAID_OFF_EPSILON = 0.005;

const round2 = (x: number): number => {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r; // never emit -0
};

/** A usable whole-month term, or undefined when missing / zero / negative / NaN. */
const usableTerm = (termMonths: number | undefined): number | undefined => {
  if (termMonths === undefined || !Number.isFinite(termMonths)) return undefined;
  const n = Math.floor(termMonths);
  return n >= 1 ? n : undefined;
};

const monthlyRateOf = (annualRate: number): number =>
  Number.isFinite(annualRate) ? annualRate / 100 / 12 : 0;

const positiveOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * The regular payment of a loan, by calculation type. Returns 0 (never
 * Infinity / NaN) when the inputs cannot describe a loan: non-positive or
 * non-finite principal, or a term that is not a whole number of months >= 1.
 *
 * For `reducing_balance` the payment changes every month; this returns the
 * first (largest) one.
 */
export const calculateLoanPaymentAmount = (params: {
  principal: number;
  annualRate: number;
  termMonths: number;
  calculationType?: LoanCalculationMode;
  interestBasis?: number;
}): number => {
  const { principal, annualRate, calculationType = "amortized" } = params;
  const n = usableTerm(params.termMonths);
  if (n === undefined || !Number.isFinite(principal) || principal <= 0) return 0;
  if (!Number.isFinite(annualRate)) return 0;

  const r = monthlyRateOf(annualRate);
  switch (calculationType) {
    case "flat_rate":
      return principal / n + positiveOr(params.interestBasis, principal) * r;
    case "reducing_balance":
      return principal / n + principal * r;
    case "amortized":
    default: {
      if (r === 0) return principal / n;
      const growth = Math.pow(1 + r, n);
      return (principal * r * growth) / (growth - 1);
    }
  }
};

/**
 * Calculate the complete amortization schedule for a loan.
 *
 * - Dates are `startDate + (monthOffset + i)` months from the fixed anchor
 *   (`addMonths`), so a 29th/30th/31st start clamps per month and recovers.
 * - Internal arithmetic is full precision; `remainingBalance` is emitted rounded
 *   to the cent. When a term is given, the last term period pays off whatever is
 *   left (the "true-up"), so the schedule always ends at exactly 0. A payment
 *   below the interest capitalises the shortfall (negative principal) instead
 *   of discarding it, so `remaining = opening + interest - paid` always holds.
 * - Unusable input yields an empty schedule (never Infinity / NaN).
 *
 * @param config - Loan configuration parameters
 * @returns Array of amortization steps showing payment breakdown over time
 */
export const calculateAmortizationSchedule = (config: LoanConfig): AmortizationStep[] => {
  const schedule: AmortizationStep[] = [];
  const type: LoanCalculationMode = config.calculationType ?? "amortized";

  let balance = config.principal;
  if (!Number.isFinite(balance) || balance <= PAID_OFF_EPSILON) return schedule;

  const r = monthlyRateOf(config.annualRate);
  const term = usableTerm(config.termMonths);
  const offset =
    config.monthOffset !== undefined && Number.isFinite(config.monthOffset)
      ? Math.max(0, Math.floor(config.monthOffset))
      : 0;

  // Per-type constants
  let levelPayment = 0; // amortized
  let principalPerMonth = 0; // flat_rate / reducing_balance
  let flatInterest = 0; // flat_rate
  if (type === "amortized") {
    levelPayment =
      positiveOr(config.monthlyPayment, 0) ||
      (term
        ? calculateLoanPaymentAmount({
            principal: balance,
            annualRate: config.annualRate,
            termMonths: term,
          })
        : 0);
    if (!levelPayment) return schedule; // no term and no payment: nothing to schedule
  } else {
    // flat / reducing need a term to know how much principal to retire each month
    if (!term) return schedule;
    principalPerMonth = balance / term;
    flatInterest = positiveOr(config.interestBasis, balance) * r;
  }

  const maxMonths = term ?? DEFAULT_MAX_MONTHS;

  for (let i = 0; i < maxMonths && balance > PAID_OFF_EPSILON; i++) {
    const interest = type === "flat_rate" ? flatInterest : balance * r;
    let principal = type === "amortized" ? levelPayment - interest : principalPerMonth;
    let payment = type === "amortized" ? levelPayment : principalPerMonth + interest;

    // Final payment: the balance is cleared early, or the term has run out.
    const isLastTermPeriod = term !== undefined && i === maxMonths - 1;
    if (principal >= balance || isLastTermPeriod) {
      principal = balance;
      payment = principal + interest;
    }

    balance -= principal;

    schedule.push({
      date: addMonths(config.startDate, offset + i),
      payment,
      principal,
      interest,
      remainingBalance: round2(balance),
    });
  }

  return schedule;
};

/** Sum of the interest column of a schedule. */
export const sumScheduleInterest = (schedule: AmortizationStep[]): number =>
  schedule.reduce((total, step) => total + step.interest, 0);
