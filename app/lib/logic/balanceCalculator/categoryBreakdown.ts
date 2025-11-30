/**
 * Category-based spending analysis
 */

import { Transaction } from "@/lib/types";

/**
 * Calculate spending breakdown by category
 * @param transactions - All transactions to analyze
 * @param type - Optional filter by transaction type
 * @returns Array of category totals with percentages, sorted by amount descending
 */
export const getCategoryBreakdown = (
  transactions: Transaction[],
  type?: "income" | "expense"
): { category: string; total: number; percentage: number }[] => {
  const categoryTotals = new Map<string, number>();
  let grandTotal = 0;

  transactions.forEach((t) => {
    if (t.status === "skipped") return;
    if (type && t.type !== type) return;

    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;
    const existing = categoryTotals.get(t.category) || 0;
    categoryTotals.set(t.category, existing + amount);
    grandTotal += amount;
  });

  const breakdown = Array.from(categoryTotals.entries())
    .map(([category, total]) => ({
      category,
      total,
      percentage: grandTotal > 0 ? (total / grandTotal) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  return breakdown;
};
