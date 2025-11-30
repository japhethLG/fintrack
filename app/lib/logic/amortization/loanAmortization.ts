/**
 * Loan amortization calculations
 */

import { AmortizationStep, LoanConfig } from "./types";

/**
 * Calculate the complete amortization schedule for a loan
 * @param config - Loan configuration parameters
 * @returns Array of amortization steps showing payment breakdown over time
 */
export const calculateAmortizationSchedule = (config: LoanConfig): AmortizationStep[] => {
  const schedule: AmortizationStep[] = [];
  let balance = config.principal;
  const monthlyRate = config.annualRate / 100 / 12;

  // Calculate fixed monthly payment if not provided
  let payment = config.monthlyPayment || 0;
  if (!payment && config.termMonths) {
    // PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
    const n = config.termMonths;
    const r = monthlyRate;
    if (r === 0) {
      payment = balance / n;
    } else {
      payment = (balance * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
    }
  }

  const currentDate = new Date(config.startDate);

  // Safety limit to prevent infinite loops if payment < interest
  const maxMonths = config.termMonths || 360;

  for (let i = 0; i < maxMonths && balance > 0.01; i++) {
    const interest = balance * monthlyRate;
    let principal = payment - interest;

    // Handle final payment
    if (principal > balance) {
      principal = balance;
      payment = principal + interest;
    }

    // If payment is too low (negative amortization), cap principal at -interest?
    // Usually means debt grows. For now assume payment >= interest
    if (principal < 0) {
      // Just to avoid breaking
      principal = 0;
    }

    balance -= principal;

    schedule.push({
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: balance,
    });

    // Advance month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return schedule;
};
