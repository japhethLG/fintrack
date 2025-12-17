/**
 * Credit card payment projection generation
 */

import { ExpenseRule, Transaction, CreditConfig } from "@/lib/types";
import { parseDate, addMonths } from "@/lib/utils/dateUtils";
import { calculateDecliningMinimumPayoff, calculateCreditCardPayoff } from "../creditCardCalculator/payoffCalculator";
import { MonthlyBreakdown } from "../creditCardCalculator/types";
import { getEffectivePayment } from "../creditCardCalculator/paymentCalculator";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

/**
 * Generate projected credit card payment transactions
 * @param rule - Expense rule with credit card configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected credit card payment transactions
 */
export const generateCreditProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.creditConfig) return [];

  const { creditConfig } = rule;

  if (creditConfig.currentBalance <= 0) return [];

  const startDateParsed = parseDate(rule.startDate);

  // Calculate the effective due date for the first payment
  let firstPaymentDate = new Date(startDateParsed);
  firstPaymentDate.setDate(creditConfig.dueDate);

  // If the due date in the start month is before the start date, move to next month
  if (firstPaymentDate < startDateParsed) {
    firstPaymentDate = addMonths(firstPaymentDate, 1);
    firstPaymentDate.setDate(
      Math.min(
        creditConfig.dueDate,
        new Date(firstPaymentDate.getFullYear(), firstPaymentDate.getMonth() + 1, 0).getDate()
      )
    );
  }

  // Generate schedule based on payment strategy
  let schedule: MonthlyBreakdown[];

  if (creditConfig.paymentStrategy === "minimum") {
    // Use declining minimum payment calculation
    schedule = calculateDecliningMinimumPayoff(creditConfig, firstPaymentDate, 600);
  } else {
    // Use fixed payment calculation for fixed/full_balance strategies
    const effectivePayment = getEffectivePayment(creditConfig);
    schedule = calculateCreditCardPayoff(
      creditConfig.currentBalance,
      creditConfig.apr,
      effectivePayment,
      firstPaymentDate,
      600
    );
  }

  // Filter to view window and convert to transactions
  return schedule
    .filter((step) => step.date >= viewStartDate && step.date <= viewEndDate)
    .map((step, index) => {
      // Adjust the date to the due date for each month
      const paymentDate = new Date(step.date);
      paymentDate.setDate(
        Math.min(
          creditConfig.dueDate,
          new Date(paymentDate.getFullYear(), paymentDate.getMonth() + 1, 0).getDate()
        )
      );

      const occurrenceId = generateOccurrenceId(
        rule.id,
        rule.frequency,
        paymentDate,
        rule.startDate,
        rule.scheduleConfig
      );
      const override = rule.occurrenceOverrides?.[occurrenceId];

      return createProjectedTransaction(
        { ...rule, amount: step.payment },
        paymentDate,
        "expense",
        "expense_rule",
        {
          principalPaid: step.principal,
          interestPaid: step.interest,
          remainingBalance: step.remainingBalance,
          paymentNumber: step.month,
          totalPayments: 0,
        },
        occurrenceId,
        override
      );
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
};

