/**
 * Expense projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { calculateOccurrences } from "./occurrenceCalculator";
import { createProjectedTransaction } from "./transactionFactory";
import { generateLoanProjections } from "./loanProjections";
import { generateCreditProjections } from "./creditProjections";
import { generateInstallmentProjections } from "./installmentProjections";

/**
 * Generate projected expense transactions from an expense rule
 * @param rule - Expense rule configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected expense transactions
 */
export const generateExpenseProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.isActive) return [];

  // Handle loan payments with amortization
  if (rule.expenseType === "cash_loan" && rule.loanConfig) {
    return generateLoanProjections(rule, viewStartDate, viewEndDate);
  }

  // Handle credit card payments
  if (rule.expenseType === "credit_card" && rule.creditConfig) {
    return generateCreditProjections(rule, viewStartDate, viewEndDate);
  }

  // Handle installment payments
  if (rule.expenseType === "installment" && rule.installmentConfig) {
    return generateInstallmentProjections(rule, viewStartDate, viewEndDate);
  }

  // Standard recurring expenses
  const occurrences = calculateOccurrences(
    {
      frequency: rule.frequency,
      startDate: rule.startDate,
      endDate: rule.endDate,
      scheduleConfig: rule.scheduleConfig,
      weekendAdjustment: rule.weekendAdjustment,
    },
    viewStartDate,
    viewEndDate
  );

  return occurrences.map((date) =>
    createProjectedTransaction(rule, date, "expense", "expense_rule")
  );
};

