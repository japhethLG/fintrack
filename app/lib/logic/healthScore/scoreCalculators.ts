/**
 * Individual component score calculators
 */

import { TrendDirection } from "./types";
import { Transaction, DayBalance } from "@/lib/types";
import { formatDate, addDays } from "@/lib/utils/dateUtils";

/**
 * Calculate the cash runway score (0-100)
 * Score based on days until balance goes negative:
 * - 90+ days = 100
 * - 60-89 days = 80
 * - 30-59 days = 60
 * - 14-29 days = 40
 * - 7-13 days = 20
 * - < 7 days = 0
 */
export const calculateRunwayScore = (
  currentBalance: number,
  transactions: Transaction[]
): { score: number; daysRemaining: number } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let balance = currentBalance;
  let daysRemaining = 0;

  // Look ahead 90 days
  for (let i = 0; i < 90; i++) {
    const currentDate = addDays(today, i);
    const dateKey = formatDate(currentDate);

    const dayTransactions = transactions.filter((t) => {
      const txDate = t.actualDate || t.scheduledDate;
      return txDate === dateKey && t.status !== "skipped" && t.status !== "completed";
    });

    dayTransactions.forEach((t) => {
      const amount = t.projectedAmount;
      if (t.type === "income") {
        balance += amount;
      } else {
        balance -= amount;
      }
    });

    if (balance < 0) {
      daysRemaining = i;
      break;
    }
    daysRemaining = i + 1;
  }

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
 */
export const calculateSavingsRateScore = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): { score: number; rate: number } => {
  let totalIncome = 0;
  let totalExpenses = 0;

  transactions.forEach((t) => {
    const date = t.actualDate || t.scheduledDate;
    if (date < startDate || date > endDate) return;
    if (t.status === "skipped") return;

    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      totalIncome += amount;
    } else {
      totalExpenses += amount;
    }
  });

  const savings = totalIncome - totalExpenses;
  const rate = totalIncome > 0 ? (savings / totalIncome) * 100 : 0;

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
 * Based on % of past transactions completed on or before scheduled date
 */
export const calculateBillPaymentScore = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): { score: number; rate: number } => {
  const today = formatDate(new Date());

  // Get past expense transactions in range
  const pastExpenses = transactions.filter((t) => {
    const date = t.scheduledDate;
    return (
      date >= startDate &&
      date <= endDate &&
      date <= today &&
      t.type === "expense" &&
      t.status !== "projected"
    );
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
 * Based on whether balance is improving, stable, or declining using linear regression
 */
export const calculateBalanceTrendScore = (
  dailyBalances: Map<string, DayBalance>,
  startDate: string,
  endDate: string
): { score: number; trend: TrendDirection } => {
  const balances: number[] = [];

  // Collect closing balances in the date range
  dailyBalances.forEach((dayBalance, dateKey) => {
    if (dateKey >= startDate && dateKey <= endDate) {
      balances.push(dayBalance.closingBalance);
    }
  });

  if (balances.length < 2) {
    return { score: 50, trend: "stable" };
  }

  // Calculate simple linear regression slope
  const n = balances.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  balances.forEach((balance, i) => {
    sumX += i;
    sumY += balance;
    sumXY += i * balance;
    sumX2 += i * i;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // Normalize slope relative to average balance
  const avgBalance = sumY / n;
  const normalizedSlope = avgBalance !== 0 ? (slope / avgBalance) * 100 : 0;

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
    score = 50;
  }

  return { score: Math.round(score), trend };
};
