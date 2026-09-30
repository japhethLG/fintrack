/**
 * Payment amount calculations for credit cards
 *
 * Blank optional fields reach this layer as NaN (`parseFloat("")`). They are
 * read as 0 here so one empty input can never turn a payment, a schedule and
 * every balance built on it into NaN.
 */

import { CreditConfig } from "./types";

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback;

/** The card balance, never negative and never NaN. */
const balanceOf = (config: CreditConfig): number => Math.max(0, finiteOr(config.currentBalance, 0));

/**
 * Calculate minimum payment based on credit card config
 * @param config - Credit card configuration
 * @returns Calculated minimum payment amount
 */
export const calculateMinimumPayment = (config: CreditConfig): number => {
  const balance = balanceOf(config);
  const monthlyInterest = balance * (finiteOr(config.apr, 0) / 100 / 12);
  const percent = finiteOr(config.minimumPaymentPercent, 0);
  const floor = finiteOr(config.minimumPaymentFloor, 0);

  if (config.minimumPaymentMethod === "percent_plus_interest") {
    const percentPortion = balance * (percent / 100);
    return Math.max(floor, percentPortion + monthlyInterest);
  }

  return Math.max(floor, balance * (percent / 100));
};

/**
 * Get the effective payment amount based on payment strategy
 * @param config - Credit card configuration
 * @returns Effective payment amount to be made
 */
export const getEffectivePayment = (config: CreditConfig): number => {
  switch (config.paymentStrategy) {
    case "fixed": {
      const fixed = finiteOr(config.fixedPaymentAmount, 0);
      return fixed > 0 ? fixed : calculateMinimumPayment(config);
    }
    case "full_balance":
      return balanceOf(config);
    case "minimum":
    default:
      return calculateMinimumPayment(config);
  }
};

/**
 * Calculate the monthly payment needed to pay off in X months
 * @param balance - Current balance
 * @param apr - Annual percentage rate
 * @param months - Target number of months to pay off
 * @returns Required monthly payment amount (0 when there is nothing to pay or
 *   the target is not a whole number of months >= 1; never Infinity)
 */
export const calculatePaymentForMonths = (
  balance: number,
  apr: number,
  months: number
): number => {
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  if (!Number.isFinite(months) || months < 1) return 0;

  const monthlyRate = finiteOr(apr, 0) / 100 / 12;

  if (monthlyRate === 0) {
    return balance / months;
  }

  // PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
  const payment = (balance * (monthlyRate * Math.pow(1 + monthlyRate, months))) /
                  (Math.pow(1 + monthlyRate, months) - 1);

  return Math.ceil(payment * 100) / 100; // Round up to nearest cent
};

/**
 * Format months as years and months string
 * @param months - Number of months
 * @returns Human-readable time string
 */
export const formatPayoffTime = (months: number): string => {
  if (!isFinite(months)) return "Never (payment too low)";

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
  }

  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }

  return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
};
