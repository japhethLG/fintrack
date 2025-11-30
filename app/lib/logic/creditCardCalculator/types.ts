/**
 * Types for credit card payoff calculations
 */

import { CreditConfig } from "@/lib/types";

export type { CreditConfig };

export interface CreditCardPayoffSummary {
  // Payoff timeline
  payoffDate: Date | null; // null if never (minimum payment trap)
  monthsToPayoff: number;

  // Total costs
  totalAmountToPay: number;
  totalInterestToPay: number;

  // Current status
  currentMonthlyInterest: number;
  effectiveMonthlyPayment: number;

  // Progress (if tracking)
  principalPaidSoFar: number;
  interestPaidSoFar: number;

  // Comparison scenarios
  scenarios: PayoffScenario[];

  // Warning flags
  isMinimumPaymentTrap: boolean; // Payment barely covers interest
  yearsToPayoff: number;
}

export interface PayoffScenario {
  name: string;
  monthlyPayment: number;
  monthsToPayoff: number;
  totalInterest: number;
  totalAmount: number;
  interestSavings: number;
  timeSavingsMonths: number;
}

export interface MonthlyBreakdown {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
}

