/**
 * Credit card payoff scenario analysis
 */

import { CreditConfig, PayoffScenario, MonthlyBreakdown } from "./types";
import { calculateCreditCardPayoff } from "./payoffCalculator";
import { getEffectivePayment, calculatePaymentForMonths } from "./paymentCalculator";

/**
 * Calculate different payment scenarios for comparison
 * @param config - Credit card configuration
 * @param currentSchedule - Current payment schedule
 * @returns Array of alternative payment scenarios with savings
 */
export const calculatePayoffScenarios = (
  config: CreditConfig,
  currentSchedule: MonthlyBreakdown[]
): PayoffScenario[] => {
  const scenarios: PayoffScenario[] = [];
  const currentMonths = currentSchedule.length;
  const currentInterest = currentSchedule[currentSchedule.length - 1]?.cumulativeInterest || 0;
  const currentTotal = currentSchedule.reduce((sum, m) => sum + m.payment, 0);

  // Scenario: Double payment
  const doublePayment = getEffectivePayment(config) * 2;
  const doubleSchedule = calculateCreditCardPayoff(
    config.currentBalance,
    config.apr,
    doublePayment
  );
  if (doubleSchedule.length > 0 && doubleSchedule[doubleSchedule.length - 1].remainingBalance < 0.01) {
    scenarios.push({
      name: "Double Payment",
      monthlyPayment: doublePayment,
      monthsToPayoff: doubleSchedule.length,
      totalInterest: doubleSchedule[doubleSchedule.length - 1].cumulativeInterest,
      totalAmount: doubleSchedule.reduce((sum, m) => sum + m.payment, 0),
      interestSavings: currentInterest - doubleSchedule[doubleSchedule.length - 1].cumulativeInterest,
      timeSavingsMonths: currentMonths - doubleSchedule.length,
    });
  }

  // Scenario: Pay off in 12 months
  const twelveMonthPayment = calculatePaymentForMonths(config.currentBalance, config.apr, 12);
  if (twelveMonthPayment > 0) {
    const twelveSchedule = calculateCreditCardPayoff(
      config.currentBalance,
      config.apr,
      twelveMonthPayment
    );
    if (twelveSchedule.length > 0) {
      scenarios.push({
        name: "Pay Off in 1 Year",
        monthlyPayment: twelveMonthPayment,
        monthsToPayoff: twelveSchedule.length,
        totalInterest: twelveSchedule[twelveSchedule.length - 1].cumulativeInterest,
        totalAmount: twelveSchedule.reduce((sum, m) => sum + m.payment, 0),
        interestSavings: currentInterest - twelveSchedule[twelveSchedule.length - 1].cumulativeInterest,
        timeSavingsMonths: currentMonths - twelveSchedule.length,
      });
    }
  }

  // Scenario: Pay off in 24 months
  const twentyFourMonthPayment = calculatePaymentForMonths(config.currentBalance, config.apr, 24);
  if (twentyFourMonthPayment > 0 && twentyFourMonthPayment < doublePayment) {
    const twentyFourSchedule = calculateCreditCardPayoff(
      config.currentBalance,
      config.apr,
      twentyFourMonthPayment
    );
    if (twentyFourSchedule.length > 0) {
      scenarios.push({
        name: "Pay Off in 2 Years",
        monthlyPayment: twentyFourMonthPayment,
        monthsToPayoff: twentyFourSchedule.length,
        totalInterest: twentyFourSchedule[twentyFourSchedule.length - 1].cumulativeInterest,
        totalAmount: twentyFourSchedule.reduce((sum, m) => sum + m.payment, 0),
        interestSavings: currentInterest - twentyFourSchedule[twentyFourSchedule.length - 1].cumulativeInterest,
        timeSavingsMonths: currentMonths - twentyFourSchedule.length,
      });
    }
  }

  return scenarios.filter(s => s.interestSavings > 0).sort((a, b) => a.monthlyPayment - b.monthlyPayment);
};

