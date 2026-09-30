/**
 * Comprehensive credit card payoff summary
 */

import { CreditConfig, CreditCardPayoffSummary } from "./types";
import { buildPayoffSchedule } from "./payoffCalculator";
import { getEffectivePayment } from "./paymentCalculator";
import { calculatePayoffScenarios } from "./scenarioCalculator";

/**
 * Calculate comprehensive payoff summary with scenarios
 * @param config - Credit card configuration
 * @param principalPaidSoFar - Principal already paid (for tracking)
 * @param interestPaidSoFar - Interest already paid (for tracking)
 * @returns Complete payoff summary with analysis
 */
export const calculatePayoffSummary = (
  config: CreditConfig,
  principalPaidSoFar: number = 0,
  interestPaidSoFar: number = 0
): CreditCardPayoffSummary => {
  const effectivePayment = getEffectivePayment(config);
  const balance = Number.isFinite(config.currentBalance) ? config.currentBalance : 0;
  const apr = Number.isFinite(config.apr) ? config.apr : 0;
  const currentMonthlyInterest = Math.max(0, balance) * (apr / 100 / 12);

  // A settled card is paid off: nothing to pay, nothing to warn about.
  if (balance <= 0.01) {
    return {
      payoffDate: new Date(),
      monthsToPayoff: 0,
      totalAmountToPay: 0,
      totalInterestToPay: 0,
      currentMonthlyInterest: 0,
      effectiveMonthlyPayment: effectivePayment,
      principalPaidSoFar,
      interestPaidSoFar,
      scenarios: [],
      isMinimumPaymentTrap: false,
      yearsToPayoff: 0,
    };
  }

  const schedule = buildPayoffSchedule(config);

  const lastPayment = schedule[schedule.length - 1];
  const willPayOff = lastPayment && lastPayment.remainingBalance < 0.01;

  // Check for minimum payment trap
  const isMinimumPaymentTrap = effectivePayment <= currentMonthlyInterest * 1.1;

  // Calculate comparison scenarios
  const scenarios = calculatePayoffScenarios(config, schedule);

  return {
    payoffDate: willPayOff ? lastPayment.date : null,
    monthsToPayoff: willPayOff ? schedule.length : Infinity,
    totalAmountToPay: willPayOff
      ? schedule.reduce((sum, m) => sum + m.payment, 0)
      : Infinity,
    totalInterestToPay: willPayOff
      ? lastPayment.cumulativeInterest
      : Infinity,
    currentMonthlyInterest,
    effectiveMonthlyPayment: effectivePayment,
    principalPaidSoFar,
    interestPaidSoFar,
    scenarios,
    isMinimumPaymentTrap,
    yearsToPayoff: willPayOff ? schedule.length / 12 : Infinity,
  };
};
