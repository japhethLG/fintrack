/**
 * Payment amount calculations for credit cards
 */

import { CreditConfig } from "./types";

/**
 * Calculate minimum payment based on credit card config
 * @param config - Credit card configuration
 * @returns Calculated minimum payment amount
 */
export const calculateMinimumPayment = (config: CreditConfig): number => {
  const monthlyInterest = config.currentBalance * (config.apr / 100 / 12);

  if (config.minimumPaymentMethod === "percent_plus_interest") {
    const percentPortion = config.currentBalance * (config.minimumPaymentPercent / 100);
    return Math.max(config.minimumPaymentFloor, percentPortion + monthlyInterest);
  }

  return Math.max(
    config.minimumPaymentFloor,
    config.currentBalance * (config.minimumPaymentPercent / 100)
  );
};

/**
 * Get the effective payment amount based on payment strategy
 * @param config - Credit card configuration
 * @returns Effective payment amount to be made
 */
export const getEffectivePayment = (config: CreditConfig): number => {
  switch (config.paymentStrategy) {
    case "fixed":
      return config.fixedPaymentAmount || calculateMinimumPayment(config);
    case "full_balance":
      return config.currentBalance;
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
 * @returns Required monthly payment amount
 */
export const calculatePaymentForMonths = (
  balance: number,
  apr: number,
  months: number
): number => {
  const monthlyRate = apr / 100 / 12;

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

