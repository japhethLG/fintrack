/**
 * Income projection generation
 */

import { IncomeSource, Transaction } from "@/lib/types";
import { calculateOccurrences } from "./occurrenceCalculator";
import { generateOccurrenceId } from "./occurrenceIdGenerator";
import { createProjectedTransaction } from "./transactionFactory";

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

  const occurrences = calculateOccurrences(
    {
      frequency: source.frequency,
      startDate: source.startDate,
      endDate: source.endDate,
      scheduleConfig: source.scheduleConfig,
      weekendAdjustment: source.weekendAdjustment,
    },
    viewStartDate,
    viewEndDate
  );

  return occurrences
    .map((date) => {
      const occurrenceId = generateOccurrenceId(
        source.id,
        source.frequency,
        date,
        source.startDate,
        source.scheduleConfig
      );
      const override = source.occurrenceOverrides?.[occurrenceId];

      return createProjectedTransaction(
        source,
        date,
        "income",
        "income_source",
        undefined,
        occurrenceId,
        override
      );
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
};

