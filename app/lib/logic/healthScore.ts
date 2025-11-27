import { Transaction, DayBalance } from "@/lib/types";
import { formatDate, addDays } from "@/lib/utils/dateUtils";

// ============================================================================
// TYPES
// ============================================================================

export interface HealthScoreBreakdown {
  /** Overall score from 0-100 */
  score: number;
  /** Grade: A, B, C, D, F */
  grade: "A" | "B" | "C" | "D" | "F";
  /** Color for UI display */
  color: string;
  /** Individual component scores */
  components: {
    /** Days until balance goes negative (0-100) */
    runway: number;
    /** Income minus expenses as % of income (0-100) */
    savingsRate: number;
    /** % of bills paid on time (0-100) */
    billPaymentRate: number;
    /** Balance trend over time (0-100) */
    balanceTrend: number;
  };
  /** Human-readable insights */
  insights: string[];
}

// ============================================================================
// SCORE CALCULATION
// ============================================================================

/**
 * Calculate the cash runway score (0-100)
 * - 90+ days = 100
 * - 60-89 days = 80
 * - 30-59 days = 60
 * - 14-29 days = 40
 * - 7-13 days = 20
 * - < 7 days = 0
 */
const calculateRunwayScore = (
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
 * Based on (income - expenses) / income
 * - >= 30% savings = 100
 * - 20-29% = 80
 * - 10-19% = 60
 * - 5-9% = 40
 * - 0-4% = 20
 * - Negative = 0
 */
const calculateSavingsRateScore = (
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
const calculateBillPaymentScore = (
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
 * Based on whether balance is improving, stable, or declining
 */
const calculateBalanceTrendScore = (
  dailyBalances: Map<string, DayBalance>,
  startDate: string,
  endDate: string
): { score: number; trend: "improving" | "stable" | "declining" } => {
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

  let trend: "improving" | "stable" | "declining";
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

/**
 * Get grade from score
 */
const getGrade = (score: number): "A" | "B" | "C" | "D" | "F" => {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
};

/**
 * Get color from score
 */
const getScoreColor = (score: number): string => {
  if (score >= 80) return "#22c55e"; // Green
  if (score >= 60) return "#eab308"; // Yellow
  if (score >= 40) return "#f97316"; // Orange
  return "#ef4444"; // Red
};

/**
 * Generate insights based on component scores
 */
const generateInsights = (
  components: HealthScoreBreakdown["components"],
  savingsRate: number,
  runwayDays: number,
  billPaymentRate: number,
  trend: "improving" | "stable" | "declining"
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
  if (savingsRate < 0) {
    insights.push("You're spending more than you earn. Review your expenses.");
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

// ============================================================================
// MAIN CALCULATION FUNCTION
// ============================================================================

/**
 * Calculate the overall financial health score
 * @param currentBalance - Current account balance
 * @param transactions - All transactions
 * @param dailyBalances - Calculated daily balances
 * @param startDate - Period start date (YYYY-MM-DD)
 * @param endDate - Period end date (YYYY-MM-DD)
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

  const { score: trendScore, trend } = calculateBalanceTrendScore(dailyBalances, startDate, endDate);

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

/**
 * Get a summary of period statistics for comparison
 */
export const getPeriodStats = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): {
  income: number;
  expenses: number;
  net: number;
  transactionCount: number;
  completedCount: number;
  skippedCount: number;
} => {
  let income = 0;
  let expenses = 0;
  let transactionCount = 0;
  let completedCount = 0;
  let skippedCount = 0;

  transactions.forEach((t) => {
    const date = t.actualDate || t.scheduledDate;
    if (date < startDate || date > endDate) return;

    transactionCount++;

    if (t.status === "skipped") {
      skippedCount++;
      return;
    }

    if (t.status === "completed") {
      completedCount++;
    }

    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      income += amount;
    } else {
      expenses += amount;
    }
  });

  return {
    income,
    expenses,
    net: income - expenses,
    transactionCount,
    completedCount,
    skippedCount,
  };
};

/**
 * Calculate income vs expense data for charting
 */
export const getIncomeExpenseChartData = (
  transactions: Transaction[],
  startDate: string,
  endDate: string,
  bucketType: "daily" | "weekly" | "monthly" = "daily"
): Array<{ label: string; date: string; income: number; expenses: number; net: number }> => {
  const buckets = new Map<string, { income: number; expenses: number }>();

  // Filter transactions in range
  const filteredTransactions = transactions.filter((t) => {
    const date = t.actualDate || t.scheduledDate;
    return date >= startDate && date <= endDate && t.status !== "skipped";
  });

  // Group by bucket
  filteredTransactions.forEach((t) => {
    const date = new Date(t.actualDate || t.scheduledDate);
    let bucketKey: string;
    let bucketLabel: string;

    if (bucketType === "daily") {
      bucketKey = formatDate(date);
      bucketLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } else if (bucketType === "weekly") {
      // Get week start (Sunday)
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay());
      bucketKey = formatDate(weekStart);
      bucketLabel = `Week of ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    } else {
      // Monthly
      bucketKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      bucketLabel = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }

    const existing = buckets.get(bucketKey) || { income: 0, expenses: 0 };
    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      existing.income += amount;
    } else {
      existing.expenses += amount;
    }

    buckets.set(bucketKey, existing);
  });

  // Convert to array and sort by date
  const result = Array.from(buckets.entries())
    .map(([date, data]) => {
      const d = new Date(date);
      let label: string;

      if (bucketType === "daily") {
        label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      } else if (bucketType === "weekly") {
        label = `Week of ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      } else {
        label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      }

      return {
        label,
        date,
        income: data.income,
        expenses: data.expenses,
        net: data.income - data.expenses,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return result;
};

/**
 * Determine the best bucket type based on date range
 */
export const getBestBucketType = (startDate: string, endDate: string): "daily" | "weekly" | "monthly" => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  if (daysDiff <= 14) return "daily";
  if (daysDiff <= 90) return "weekly";
  return "monthly";
};

