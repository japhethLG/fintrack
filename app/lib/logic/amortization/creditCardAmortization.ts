/**
 * Credit card amortization/projection calculations
 */

import { AmortizationStep, CreditCardProjectionConfig } from "./types";

/**
 * Calculate credit card payment projection based on minimum payment rules
 * @param config - Credit card projection configuration
 * @returns Array of projected payment steps
 */
export const calculateCreditCardProjection = (
  config: CreditCardProjectionConfig
): AmortizationStep[] => {
  const {
    currentBalance,
    apr,
    minPaymentPercentage,
    monthsToProject = 12,
    startDate,
    minPaymentFloor = 25,
    minPaymentMethod = "percent_only",
    dueDate,
  } = config;

  const schedule: AmortizationStep[] = [];
  let balance = currentBalance;
  const monthlyRate = apr / 100 / 12;
  const currentDate = new Date(startDate);

  // Set to the due date if provided
  if (dueDate) {
    currentDate.setDate(dueDate);
    // If the due date has already passed this month, start next month
    if (currentDate < startDate) {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  for (let i = 0; i < monthsToProject && balance > 0; i++) {
    const interest = balance * monthlyRate;

    // Calculate minimum payment based on method
    let payment: number;
    if (minPaymentMethod === "percent_plus_interest") {
      // Method: percentage of balance + monthly interest
      const percentPortion = balance * (minPaymentPercentage / 100);
      payment = Math.max(minPaymentFloor, percentPortion + interest);
    } else {
      // Method: percentage of balance only (default)
      payment = Math.max(minPaymentFloor, balance * (minPaymentPercentage / 100));
    }

    if (payment > balance + interest) {
      payment = balance + interest;
    }

    const principal = payment - interest;
    balance -= principal;

    schedule.push({
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: Math.max(0, balance),
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
    // Ensure the day stays on the due date (handles month length differences)
    if (dueDate) {
      currentDate.setDate(dueDate);
    }
  }

  return schedule;
};

/**
 * Legacy function signature for backward compatibility
 * @deprecated Use calculateCreditCardProjection with config object instead
 */
export const calculateCreditCardProjectionLegacy = (
  currentBalance: number,
  apr: number,
  minPaymentPercentage: number,
  monthsToProject: number = 12,
  startDate: Date,
  minPaymentFloor: number = 25,
  minPaymentMethod: "percent_only" | "percent_plus_interest" = "percent_only",
  dueDate?: number
): AmortizationStep[] => {
  return calculateCreditCardProjection({
    currentBalance,
    apr,
    minPaymentPercentage,
    monthsToProject,
    startDate,
    minPaymentFloor,
    minPaymentMethod,
    dueDate,
  });
};
