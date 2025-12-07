/**
 * Loan payment projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { parseDate } from "@/lib/utils/dateUtils";
import { calculateAmortizationSchedule } from "../amortization";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

/**
 * Generate projected loan payment transactions with amortization
 * @param rule - Expense rule with loan configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected loan payment transactions
 */
export const generateLoanProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.loanConfig) return [];

  const { loanConfig } = rule;

  // Calculate remaining payments from current state
  const remainingPayments = loanConfig.termMonths - loanConfig.paymentsMade;
  if (remainingPayments <= 0) return [];

  // Generate amortization schedule starting from current balance
  const schedule = calculateAmortizationSchedule({
    principal: loanConfig.currentBalance,
    annualRate: loanConfig.interestRate,
    termMonths: remainingPayments,
    startDate: parseDate(rule.startDate),
  });

  // Filter to view period and map to transactions
  return schedule
    .filter((step) => step.date >= viewStartDate && step.date <= viewEndDate)
    .map((step, index) => {
      const paymentNumber = loanConfig.paymentsMade + index + 1;
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
          paymentNumber,
          totalPayments: loanConfig.termMonths,
        },
        occurrenceId,
        override
      );
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
};

