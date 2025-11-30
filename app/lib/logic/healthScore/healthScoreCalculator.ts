/**
 * Main health score calculation
 */

import { HealthScoreBreakdown } from "./types";
import { Transaction, DayBalance } from "@/lib/types";
import {
  calculateRunwayScore,
  calculateSavingsRateScore,
  calculateBillPaymentScore,
  calculateBalanceTrendScore,
} from "./scoreCalculators";
import { generateInsights, getGrade, getScoreColor } from "./insights";

/**
 * Calculate the overall financial health score
 * @param currentBalance - Current account balance
 * @param transactions - All transactions
 * @param dailyBalances - Calculated daily balances
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
 * @returns Complete health score breakdown with grade and insights
 */
export const calculateHealthScore = (
  currentBalance: number,
  transactions: Transaction[],
  dailyBalances: Map<string, DayBalance>,
  startDate: string,
  endDate: string
): HealthScoreBreakdown => {
  // Calculate individual component scores
  const { score: runwayScore, daysRemaining } = calculateRunwayScore(currentBalance, transactions);

  const { score: savingsScore, rate: savingsRate } = calculateSavingsRateScore(
    transactions,
    startDate,
    endDate
  );

  const { score: billPaymentScore, rate: billPaymentRate } = calculateBillPaymentScore(
    transactions,
    startDate,
    endDate
  );

  const { score: trendScore, trend } = calculateBalanceTrendScore(
    dailyBalances,
    startDate,
    endDate
  );

  // Calculate weighted average
  // Weights: Runway 30%, Savings 30%, Bill Payment 20%, Trend 20%
  const overallScore = Math.round(
    runwayScore * 0.3 + savingsScore * 0.3 + billPaymentScore * 0.2 + trendScore * 0.2
  );

  const components = {
    runway: runwayScore,
    savingsRate: savingsScore,
    billPaymentRate: billPaymentScore,
    balanceTrend: trendScore,
  };

  const insights = generateInsights(components, savingsRate, daysRemaining, billPaymentRate, trend);

  return {
    score: overallScore,
    grade: getGrade(overallScore),
    color: getScoreColor(overallScore),
    components,
    insights,
  };
};
