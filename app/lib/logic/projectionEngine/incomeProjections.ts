/**
 * Income projection generation
 */

import { IncomeSource, Transaction } from "@/lib/types";
import { generateRecurringProjections } from "./recurringProjections";

/**
 * Generate projected income transactions from an income source
 * @param source - Income source configuration
 * @param viewStartDate - Start of projection period
 * @param viewEndDate - End of projection period
 * @returns Array of projected income transactions
 */
export const generateIncomeProjections = (
  source: IncomeSource,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!source.isActive) return [];

  return generateRecurringProjections(
    source,
    "income",
    "income_source",
    viewStartDate,
    viewEndDate
  );
};
