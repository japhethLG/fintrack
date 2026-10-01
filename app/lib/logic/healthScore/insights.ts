/**
 * Health score insights generation
 */

import { HealthScoreBreakdown, TrendDirection } from "./types";

/** Lower is shown first. A warning is never dropped in favour of a compliment. */
type Severity = 0 | 1 | 2 | 3;
const DANGER: Severity = 0;
const WARNING: Severity = 1;
const NOTE: Severity = 2;
const PRAISE: Severity = 3;

/**
 * Generate insights based on component scores, ranked by severity.
 *
 * Danger first, then warnings, then notes, then praise; insights of equal severity keep the order
 * runway, savings, bills, trend. Only the top 3 are returned, so the only warning can never be
 * crowded out by three compliments.
 *
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
  const insights: { text: string; severity: Severity }[] = [];
  const add = (text: string, severity: Severity) => insights.push({ text, severity });

  // Runway insights
  if (runwayDays < 14) {
    add("Your cash runway is critically low. Consider reducing expenses.", DANGER);
  } else if (runwayDays < 30) {
    add("Your cash runway is low. Try to build a buffer.", WARNING);
  } else if (runwayDays >= 90) {
    add("Great cash runway! You have 90+ days of expenses covered.", PRAISE);
  }

  // Savings rate insights
  // Note: When savingsRate is 0 but score is 100, it means no transactions (not poor savings)
  if (savingsRate < 0) {
    add("You're spending more than you earn. Review your expenses.", DANGER);
  } else if (savingsRate === 0 && components.savingsRate === 100) {
    // No transactions case - don't penalize, just inform
    add("No income or expenses recorded for this period.", NOTE);
  } else if (savingsRate < 10) {
    add("Try to increase your savings rate to at least 10%.", WARNING);
  } else if (savingsRate >= 20) {
    add("Excellent savings rate! You're building wealth effectively.", PRAISE);
  }

  // Bill payment insights
  if (billPaymentRate < 80) {
    add("Improve bill payment timing to avoid late fees.", WARNING);
  } else if (billPaymentRate === 100) {
    add("Perfect bill payment record!", PRAISE);
  }

  // Trend insights
  if (trend === "declining") {
    add("Your balance is trending downward. Monitor your spending.", WARNING);
  } else if (trend === "improving") {
    add("Your balance is trending upward. Keep it up!", PRAISE);
  }

  // Array.prototype.sort is stable: equal severities keep their push order.
  return insights
    .sort((a, b) => a.severity - b.severity)
    .slice(0, 3)
    .map((insight) => insight.text);
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
