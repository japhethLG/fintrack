/**
 * Individual component score calculators
 */

import { TrendDirection } from "./types";
import { Transaction, DayBalance } from "@/lib/types";
import { getTodayKey } from "@/lib/utils/dateUtils";
import { getRunway, RISK_HORIZON_DAYS } from "@/lib/logic/balanceCalculator/runway";
import { amountOf, rowDate } from "@/lib/logic/balanceCalculator/openItems";
import { savingsRatePercent } from "./periodStats";

/**
 * Calculate the cash runway score (0-100)
 * Score based on days until balance goes negative:
 * - 90+ days = 100
 * - 60-89 days = 80
 * - 30-59 days = 60
 * - 14-29 days = 40
 * - 7-13 days = 20
 * - < 7 days = 0
 *
 * This is the SAME walk as the Forecast's Cash Runway (`getRunway`): realized balance, overdue
 * expenses folded into day 0, completed rows excluded, one horizon. The first negative date can
 * therefore never differ between the two.
 */
export const calculateRunwayScore = (
  currentBalance: number,
  transactions: Transaction[],
  today: string = getTodayKey()
): { score: number; daysRemaining: number } => {
  const { days: daysRemaining } = getRunway(currentBalance, transactions, RISK_HORIZON_DAYS, today);

  // Score based on days remaining
  let score: number;
  if (daysRemaining >= 90) score = 100;
  else if (daysRemaining >= 60) score = 80;
  else if (daysRemaining >= 30) score = 60;
  else if (daysRemaining >= 14) score = 40;
  else if (daysRemaining >= 7) score = 20;
  else score = 0;

  return { score, daysRemaining };
};

/**
 * Calculate savings rate score (0-100)
 * Based on (income - expenses) / income:
 * - >= 30% savings = 100
 * - 20-29% = 80
 * - 10-19% = 60
 * - 5-9% = 40
 * - 0-4% = 20
 * - Negative = 0
 *
 * Spending with NO income at all is the worst case, not "breaking even": rate -100, score 0.
 */
export const calculateSavingsRateScore = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): { score: number; rate: number } => {
  let totalIncome = 0;
  let totalExpenses = 0;

  transactions.forEach((t) => {
    const date = rowDate(t);
    if (date < startDate || date > endDate) return;
    if (t.status === "skipped") return;

    const amount = amountOf(t);

    if (t.type === "income") {
      totalIncome += amount;
    } else {
      totalExpenses += amount;
    }
  });

  // Edge case: No transactions = neutral score, not penalized
  if (totalIncome === 0 && totalExpenses === 0) {
    return { score: 100, rate: 0 };
  }

  const rate = savingsRatePercent(totalIncome, totalExpenses);

  let score: number;
  if (rate >= 30) score = 100;
  else if (rate >= 20) score = 80;
  else if (rate >= 10) score = 60;
  else if (rate >= 5) score = 40;
  else if (rate >= 0) score = 20;
  else score = 0;

  return { score, rate };
};

/**
 * Calculate bill payment rate score (0-100)
 * Based on % of past bills (due on or before today, in the period) that were paid on or before
 * their due date. A bill that came due and was never paid or skipped (still "projected") is
 * OVERDUE and counts in the denominator, so an untouched overdue bill can no longer earn a perfect
 * record.
 */
export const calculateBillPaymentScore = (
  transactions: Transaction[],
  startDate: string,
  endDate: string,
  today: string = getTodayKey()
): { score: number; rate: number } => {
  // Get past expense transactions in range (paid, skipped or still owed)
  const pastExpenses = transactions.filter((t) => {
    const date = t.scheduledDate;
    if (date < startDate || date > endDate || t.type !== "expense") return false;
    // Paid or skipped rows count once due (today included); an UNTOUCHED row is overdue only after
    // its due day has passed (a bill due today is not late yet).
    return t.status === "projected" ? date < today : date <= today;
  });

  if (pastExpenses.length === 0) {
    return { score: 100, rate: 100 }; // No bills = perfect score
  }

  // Count on-time payments
  const onTime = pastExpenses.filter((t) => {
    if (t.status === "completed") {
      // Check if paid on or before due date
      const paidDate = t.actualDate || t.scheduledDate;
      return paidDate <= t.scheduledDate;
    }
    return false;
  });

  const rate = (onTime.length / pastExpenses.length) * 100;
  const score = Math.round(rate);

  return { score, rate };
};

/**
 * Calculate balance trend score (0-100)
 * Based on whether balance is improving, stable, or declining using linear regression.
 *
 * The slope is normalised by the MEAN ABSOLUTE balance (not the signed average), so the verdict
 * follows the sign of the slope for an overdrawn account too: -1,000 falling to -2,500 is
 * declining, -2,000 recovering to -500 is improving, and a balance climbing through zero is
 * improving rather than "stable" (the signed average of such a series is 0). The days are put in
 * date order first, whatever order the map was built in.
 */
export const calculateBalanceTrendScore = (
  dailyBalances: Map<string, DayBalance>,
  startDate: string,
  endDate: string
): { score: number; trend: TrendDirection } => {
  // Collect closing balances in the date range, in date order
  const days: { date: string; balance: number }[] = [];
  dailyBalances.forEach((dayBalance, dateKey) => {
    if (dateKey >= startDate && dateKey <= endDate) {
      days.push({ date: dateKey, balance: dayBalance.closingBalance });
    }
  });
  days.sort((a, b) => a.date.localeCompare(b.date));
  const balances = days.map((d) => d.balance);

  if (balances.length < 2) {
    return { score: 65, trend: "stable" }; // Insufficient data = assume stable
  }

  // Calculate simple linear regression slope
  const n = balances.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  let sumAbs = 0;

  balances.forEach((balance, i) => {
    sumX += i;
    sumY += balance;
    sumXY += i * balance;
    sumX2 += i * i;
    sumAbs += Math.abs(balance);
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Normalize slope relative to the typical size of the balance (always positive)
  const scale = sumAbs / n;
  const normalizedSlope = scale > 0 ? (slope / scale) * 100 : 0;

  let trend: TrendDirection;
  let score: number;

  if (normalizedSlope > 0.5) {
    trend = "improving";
    score = Math.min(100, 70 + normalizedSlope * 10);
  } else if (normalizedSlope < -0.5) {
    trend = "declining";
    score = Math.max(0, 30 + normalizedSlope * 10);
  } else {
    trend = "stable";
    score = 65; // Stable is positive, not neutral
  }

  return { score: Math.round(score), trend };
};
