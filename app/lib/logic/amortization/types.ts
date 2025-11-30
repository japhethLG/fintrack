/**
 * Types and interfaces for amortization calculations
 */

export interface AmortizationStep {
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export interface LoanConfig {
  principal: number;
  annualRate: number; // e.g., 5.5 for 5.5%
  termMonths?: number;
  monthlyPayment?: number;
  startDate: Date;
}

export interface CreditCardProjectionConfig {
  currentBalance: number;
  apr: number;
  minPaymentPercentage: number;
  monthsToProject?: number;
  startDate: Date;
  minPaymentFloor?: number;
  minPaymentMethod?: "percent_only" | "percent_plus_interest";
  dueDate?: number; // Day of month for payments (1-31)
}
