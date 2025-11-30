/**
 * Core credit card payoff calculations
 */

import { MonthlyBreakdown } from "./types";

/**
 * Calculate full payoff schedule for a credit card
 * @param currentBalance - Current card balance
 * @param apr - Annual percentage rate
 * @param monthlyPayment - Fixed monthly payment amount
 * @param startDate - Start date for projection
 * @param maxMonths - Maximum months to project (default: 600 = 50 years)
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
  let balance = currentBalance;
  const monthlyRate = apr / 100 / 12;
  const currentDate = new Date(startDate);
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;

  for (let month = 1; month <= maxMonths && balance > 0.01; month++) {
    const interest = balance * monthlyRate;
    let payment = monthlyPayment;

    // Handle final payment
    if (payment > balance + interest) {
      payment = balance + interest;
    }

    // Check for negative amortization (payment doesn't cover interest)
    const principal = Math.max(0, payment - interest);
    balance = Math.max(0, balance - principal);

    cumulativeInterest += interest;
    cumulativePrincipal += principal;

    schedule.push({
      month,
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: balance,
      cumulativeInterest,
      cumulativePrincipal,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);

    // Break if balance isn't decreasing (minimum payment trap)
    if (month > 12 && principal < 0.01) {
      break;
    }
  }

  return schedule;
};

