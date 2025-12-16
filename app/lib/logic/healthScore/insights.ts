/**
 * Health score insights generation
 */

import { HealthScoreBreakdown, TrendDirection } from "./types";

/**
 * Generate insights based on component scores
 * @param components - Individual component scores
 * @param savingsRate - Actual savings rate percentage
 * @param runwayDays - Days of cash runway
 * @param billPaymentRate - Bill payment rate percentage
 * @param trend - Balance trend direction
 * @returns Array of top 3 insights
 */
export const generateInsights = (
  components: HealthScoreBreakdown["components"],
  savingsRate: number,
  runwayDays: number,
  billPaymentRate: number,
  trend: TrendDirection
): string[] => {
  const insights: string[] = [];

  // Runway insights
  if (runwayDays < 14) {
    insights.push("Your cash runway is critically low. Consider reducing expenses.");
  } else if (runwayDays < 30) {
    insights.push("Your cash runway is low. Try to build a buffer.");
  } else if (runwayDays >= 90) {
    insights.push("Great cash runway! You have 90+ days of expenses covered.");
  }

  // Savings rate insights
  // Note: When savingsRate is 0 but score is 100, it means no transactions (not poor savings)
  if (savingsRate < 0) {
    insights.push("You're spending more than you earn. Review your expenses.");
  } else if (savingsRate === 0 && components.savingsRate === 100) {
    // No transactions case - don't penalize, just inform
    insights.push("No income or expenses recorded for this period.");
  } else if (savingsRate < 10) {
    insights.push("Try to increase your savings rate to at least 10%.");
  } else if (savingsRate >= 20) {
    insights.push("Excellent savings rate! You're building wealth effectively.");
  }

  // Bill payment insights
  if (billPaymentRate < 80) {
    insights.push("Improve bill payment timing to avoid late fees.");
  } else if (billPaymentRate === 100) {
    insights.push("Perfect bill payment record!");
  }

  // Trend insights
  if (trend === "declining") {
    insights.push("Your balance is trending downward. Monitor your spending.");
  } else if (trend === "improving") {
    insights.push("Your balance is trending upward. Keep it up!");
  }

  return insights.slice(0, 3); // Return top 3 insights
};

/**
 * Get grade from score
 */
export const getGrade = (score: number): "A" | "B" | "C" | "D" | "F" => {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
};

/**
 * Get color from score
 */
export const getScoreColor = (score: number): string => {
  if (score >= 80) return "#22c55e"; // Green
  if (score >= 60) return "#eab308"; // Yellow
  if (score >= 40) return "#f97316"; // Orange
  return "#ef4444"; // Red
};

