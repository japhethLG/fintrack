/**
 * Types and interfaces for amortization calculations
 */

export interface AmortizationStep {
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  /** Balance after this payment, rounded to whole cents. */
  remainingBalance: number;
}

/**
 * How a loan charges interest (mirrors `LoanCalculationType` in `@/lib/types`).
 *
 * - `amortized`: level payment (PMT), interest on the declining balance.
 * - `flat_rate`: interest on the ORIGINAL principal every month, level payment.
 * - `reducing_balance`: equal principal every month, interest on the declining
 *   balance, so the payment falls over time.
 *
 * See docs/audit/fixes/debt.md for the definitions and worked examples.
 */
export type LoanCalculationMode = "amortized" | "flat_rate" | "reducing_balance";

export interface LoanConfig {
  principal: number;
  annualRate: number; // e.g., 5.5 for 5.5%
  termMonths?: number;
  /**
   * The contractual level payment. Honoured for `amortized` loans only: the
   * payment of a flat or reducing-balance loan is defined by its formula.
   */
  monthlyPayment?: number;
  startDate: Date;
  calculationType?: LoanCalculationMode;
  /**
   * `flat_rate` only: the principal the flat interest is charged on. Defaults
   * to `principal`; differs when part of the loan has already been repaid.
   */
  interestBasis?: number;
  /**
   * Payments already made. Step `i` is dated `startDate + (monthOffset + i)`
   * months, always computed from the ORIGINAL anchor so a month-end day never
   * drifts.
   */
  monthOffset?: number;
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
