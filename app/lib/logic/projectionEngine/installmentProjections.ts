/**
 * Installment payment projection generation
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { parseDate, addMonths } from "@/lib/utils/dateUtils";
import { adjustForWeekend } from "./dateUtils";
import { createProjectedTransaction } from "./transactionFactory";

/**
 * Generate projected installment payment transactions
 * @param rule - Expense rule with installment configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected installment payment transactions
 */
export const generateInstallmentProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.installmentConfig) return [];

  const { installmentConfig } = rule;

  const remainingInstallments =
    installmentConfig.installmentCount - installmentConfig.installmentsPaid;
  if (remainingInstallments <= 0) return [];

  const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];
  let currentDate = parseDate(rule.startDate);

  // Skip already paid installments
  for (let i = 0; i < installmentConfig.installmentsPaid; i++) {
    currentDate = addMonths(currentDate, 1);
  }

  for (let i = 0; i < remainingInstallments; i++) {
    if (currentDate > viewEndDate) break;

    if (currentDate >= viewStartDate) {
      const adjustedDate = adjustForWeekend(currentDate, rule.weekendAdjustment);
      const paymentNumber = installmentConfig.installmentsPaid + i + 1;

      projections.push(
        createProjectedTransaction(
          { ...rule, amount: installmentConfig.installmentAmount },
          adjustedDate,
          "expense",
          "expense_rule",
          {
            principalPaid: installmentConfig.installmentAmount,
            interestPaid: 0,
            remainingBalance:
              (installmentConfig.installmentCount - paymentNumber) *
              installmentConfig.installmentAmount,
            paymentNumber,
            totalPayments: installmentConfig.installmentCount,
          }
        )
      );
    }

    currentDate = addMonths(currentDate, 1);
  }

  return projections;
};

