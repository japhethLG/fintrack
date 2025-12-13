/**
 * Credit card payment projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { parseDate, addMonths } from "@/lib/utils/dateUtils";
import { calculateCreditCardProjection } from "../amortization";
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

  // Calculate payment amount based on strategy
  let paymentAmount: number;
  const monthlyInterest = creditConfig.currentBalance * (creditConfig.apr / 100 / 12);

  switch (creditConfig.paymentStrategy) {
    case "minimum":
      if (creditConfig.minimumPaymentMethod === "percent_plus_interest") {
        // Method: percentage of balance + monthly interest
        const percentPortion =
          creditConfig.currentBalance * (creditConfig.minimumPaymentPercent / 100);
        paymentAmount = Math.max(
          creditConfig.minimumPaymentFloor,
          percentPortion + monthlyInterest
        );
      } else {
        // Method: percentage of balance only (default)
        paymentAmount = Math.max(
          creditConfig.minimumPaymentFloor,
          creditConfig.currentBalance * (creditConfig.minimumPaymentPercent / 100)
        );
      }
      break;
    case "fixed":
      paymentAmount = creditConfig.fixedPaymentAmount || creditConfig.minimumPaymentFloor;
      break;
    case "full_balance":
      paymentAmount = creditConfig.currentBalance;
      break;
  }

  // Generate credit card projection
  const schedule = calculateCreditCardProjection({
    currentBalance: creditConfig.currentBalance,
    apr: creditConfig.apr,
    minPaymentPercentage: creditConfig.minimumPaymentPercent,
    monthsToProject: 12,
    startDate: parseDate(rule.startDate),
    minPaymentFloor: creditConfig.minimumPaymentFloor,
    minPaymentMethod: creditConfig.minimumPaymentMethod || "percent_only",
    dueDate: creditConfig.dueDate,
  });

  // Override payment amounts if using fixed or full balance strategy
  if (creditConfig.paymentStrategy !== "minimum") {
    // Recalculate with fixed payment
    let balance = creditConfig.currentBalance;
    const monthlyRate = creditConfig.apr / 100 / 12;
    const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];

    const startDateParsed = parseDate(rule.startDate);
    let currentDate = new Date(startDateParsed);
    currentDate.setDate(creditConfig.dueDate);

    // If the due date in the start month is before the start date, move to next month
    if (currentDate < startDateParsed) {
      currentDate = addMonths(currentDate, 1);
      // Re-set the day in case month length differs
      currentDate.setDate(
        Math.min(
          creditConfig.dueDate,
          new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
        )
      );
    }

    let paymentNum = 1;
    while (balance > 0 && currentDate <= viewEndDate) {
      if (currentDate >= viewStartDate) {
        const occurrenceId = generateOccurrenceId(
          rule.id,
          rule.frequency,
          currentDate,
          rule.startDate,
          rule.scheduleConfig
        );
        const override = rule.occurrenceOverrides?.[occurrenceId];
        const interest = balance * monthlyRate;
        const actualPayment = Math.min(paymentAmount, balance + interest);
        const principal = actualPayment - interest;

        const transaction = createProjectedTransaction(
          { ...rule, amount: actualPayment },
          new Date(currentDate),
          "expense",
          "expense_rule",
          {
            principalPaid: principal,
            interestPaid: interest,
            remainingBalance: Math.max(0, balance - principal),
            paymentNumber: paymentNum,
            totalPayments: 0, // Unknown for credit cards
          },
          occurrenceId,
          override
        );

        if (transaction) {
          projections.push(transaction);
        }

        balance = Math.max(0, balance - principal);
        paymentNum++;
      }

      currentDate = addMonths(currentDate, 1);
      // Re-set the day in case month length differs
      currentDate.setDate(
        Math.min(
          creditConfig.dueDate,
          new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
        )
      );
    }

    return projections;
  }

  // Use minimum payment schedule
  return schedule
    .filter((step) => step.date >= viewStartDate && step.date <= viewEndDate)
    .map((step, index) => {
      const occurrenceId = generateOccurrenceId(
        rule.id,
        rule.frequency,
        step.date,
        rule.startDate,
        rule.scheduleConfig
      );
      const override = rule.occurrenceOverrides?.[occurrenceId];

      return createProjectedTransaction(
        { ...rule, amount: step.payment },
        step.date,
        "expense",
        "expense_rule",
        {
          principalPaid: step.principal,
          interestPaid: step.interest,
          remainingBalance: step.remainingBalance,
          paymentNumber: index + 1,
          totalPayments: 0,
        },
        occurrenceId,
        override
      );
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
};
