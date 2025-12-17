/**
 * Comprehensive credit card payoff summary
 */

import { CreditConfig, CreditCardPayoffSummary, MonthlyBreakdown } from "./types";
import { calculateCreditCardPayoff, calculateDecliningMinimumPayoff } from "./payoffCalculator";
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
  const currentMonthlyInterest = config.currentBalance * (config.apr / 100 / 12);

  // Use declining minimum calculation for minimum strategy,
  // fixed payment calculation for fixed/full_balance strategies
  let schedule: MonthlyBreakdown[];
  if (config.paymentStrategy === "minimum") {
    schedule = calculateDecliningMinimumPayoff(config);
  } else {
    schedule = calculateCreditCardPayoff(
      config.currentBalance,
      config.apr,
      effectivePayment
    );
  }

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
