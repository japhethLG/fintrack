/**
 * Credit card payoff scenario analysis
 */

import { CreditConfig, PayoffScenario, MonthlyBreakdown } from "./types";
import { calculateCreditCardPayoff } from "./payoffCalculator";
import { getEffectivePayment, calculatePaymentForMonths } from "./paymentCalculator";

/** A schedule ends paid off when its last row leaves (almost) nothing owed. */
const endsPaidOff = (schedule: MonthlyBreakdown[]): boolean =>
  schedule.length > 0 && schedule[schedule.length - 1].remainingBalance < 0.01;

/**
 * Calculate different payment scenarios for comparison
 *
 * Savings are measured against the current plan. When the current plan never
 * pays the card off (`currentSchedule` does not end at zero) it has no finite
 * interest or duration, so escaping it saves an unbounded amount of both:
 * `interestSavings` and `timeSavingsMonths` are `Infinity` rather than a figure
 * taken from a truncated slice of a debt that does not end.
 *
 * @param config - Credit card configuration
 * @param currentSchedule - Current payment schedule
 * @returns Array of alternative payment scenarios with savings
 */
export const calculatePayoffScenarios = (
  config: CreditConfig,
  currentSchedule: MonthlyBreakdown[]
): PayoffScenario[] => {
  const scenarios: PayoffScenario[] = [];
  // No schedule means nothing is owed on the current plan, so there is nothing to save.
  if (currentSchedule.length === 0) return scenarios;
  const currentTerminates = endsPaidOff(currentSchedule);
  const currentMonths = currentTerminates ? currentSchedule.length : Infinity;
  const currentInterest = currentTerminates
    ? currentSchedule[currentSchedule.length - 1].cumulativeInterest
    : Infinity;

  const balance = Number.isFinite(config.currentBalance) ? config.currentBalance : 0;
  if (balance <= 0.01) return scenarios;

  const addScenario = (name: string, monthlyPayment: number, schedule: MonthlyBreakdown[]) => {
    const last = schedule[schedule.length - 1];
    scenarios.push({
      name,
      monthlyPayment,
      monthsToPayoff: schedule.length,
      totalInterest: last.cumulativeInterest,
      totalAmount: schedule.reduce((sum, m) => sum + m.payment, 0),
      interestSavings: currentInterest - last.cumulativeInterest,
      timeSavingsMonths: currentMonths - schedule.length,
    });
  };

  // Scenario: Double payment
  const doublePayment = getEffectivePayment(config) * 2;
  const doubleSchedule = calculateCreditCardPayoff(balance, config.apr, doublePayment);
  if (endsPaidOff(doubleSchedule)) {
    addScenario("Double Payment", doublePayment, doubleSchedule);
  }

  // Scenario: Pay off in 12 months
  const twelveMonthPayment = calculatePaymentForMonths(balance, config.apr, 12);
  if (twelveMonthPayment > 0) {
    const twelveSchedule = calculateCreditCardPayoff(balance, config.apr, twelveMonthPayment);
    if (twelveSchedule.length > 0) {
      addScenario("Pay Off in 1 Year", twelveMonthPayment, twelveSchedule);
    }
  }

  // Scenario: Pay off in 24 months
  const twentyFourMonthPayment = calculatePaymentForMonths(balance, config.apr, 24);
  if (twentyFourMonthPayment > 0 && twentyFourMonthPayment < doublePayment) {
    const twentyFourSchedule = calculateCreditCardPayoff(balance, config.apr, twentyFourMonthPayment);
    if (twentyFourSchedule.length > 0) {
      addScenario("Pay Off in 2 Years", twentyFourMonthPayment, twentyFourSchedule);
    }
  }

  return scenarios.filter(s => s.interestSavings > 0).sort((a, b) => a.monthlyPayment - b.monthlyPayment);
};
