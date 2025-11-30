/**
 * Main projection generation orchestrator
 */

import { IncomeSource, ExpenseRule, Transaction } from "@/lib/types";
import { generateIncomeProjections } from "./incomeProjections";
import { generateExpenseProjections } from "./expenseProjections";

/**
 * Generate all projected transactions from income sources and expense rules
 * @param incomeSources - Array of income source configurations
 * @param expenseRules - Array of expense rule configurations
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of all projected transactions, sorted by date
 */
export const generateProjections = (
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[],
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];

  // Generate income projections
  incomeSources.forEach((source) => {
    const incomeProjections = generateIncomeProjections(source, viewStartDate, viewEndDate);
    projections.push(...incomeProjections);
  });

  // Generate expense projections
  expenseRules.forEach((rule) => {
    const expenseProjections = generateExpenseProjections(rule, viewStartDate, viewEndDate);
    projections.push(...expenseProjections);
  });

  // Sort by date
  projections.sort(
    (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
  );

  return projections;
};

