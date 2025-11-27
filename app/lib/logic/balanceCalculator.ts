import {
  Transaction,
  DayBalance,
  BalanceStatus,
  BillCoverageReport,
  UpcomingBill,
  VarianceReport,
} from "@/lib/types";
import { formatDate, parseDate, addDays } from "@/lib/utils/dateUtils";

// ============================================================================
// DATE UTILITIES
// ============================================================================

const getDaysBetween = (start: Date, end: Date): Date[] => {
  const days: Date[] = [];
  let current = new Date(start);

  while (current <= end) {
    days.push(new Date(current));
    current = addDays(current, 1);
  }

  return days;
};

// ============================================================================
// BALANCE STATUS
// ============================================================================

export const getBalanceStatus = (balance: number, warningThreshold: number): BalanceStatus => {
  if (balance < 0) return "danger";
  if (balance < warningThreshold) return "warning";
  return "safe";
};

// ============================================================================
// DAILY BALANCE CALCULATION
// ============================================================================

export const calculateDailyBalances = (
  currentBalance: number, // User's actual bank balance (includes completed transactions)
  transactions: Transaction[],
  startDate: Date,
  endDate: Date,
  warningThreshold: number = 500
): Map<string, DayBalance> => {
  const balances = new Map<string, DayBalance>();

  // Calculate the opening balance by "undoing" completed transactions.
  // Since currentBalance already includes completed transactions,
  // we need to reverse their effect to get the balance before any transactions.
  let openingBalance = currentBalance;
  transactions.forEach((t) => {
    if (t.status === "completed" || t.status === "partial") {
      const amount = t.actualAmount ?? t.projectedAmount;
      if (t.type === "income") {
        openingBalance -= amount; // Undo income (subtract it)
      } else {
        openingBalance += amount; // Undo expense (add it back)
      }
    }
  });

  // Group transactions by date
  const transactionsByDate = new Map<string, Transaction[]>();
  transactions.forEach((t) => {
    const dateKey = t.actualDate || t.scheduledDate;
    const existing = transactionsByDate.get(dateKey) || [];
    existing.push(t);
    transactionsByDate.set(dateKey, existing);
  });

  // Calculate balance for each day starting from the opening balance
  let runningBalance = openingBalance;
  const days = getDaysBetween(startDate, endDate);

  days.forEach((day) => {
    const dateKey = formatDate(day);
    const dayTransactions = transactionsByDate.get(dateKey) || [];

    // Calculate income and expenses for this day
    let income = 0;
    let expenses = 0;

    dayTransactions.forEach((t) => {
      // Use actual amount if completed, otherwise projected
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      // Skip skipped transactions
      if (t.status === "skipped") return;

      if (t.type === "income") {
        income += amount;
      } else {
        expenses += amount;
      }
    });

    const openingBalance = runningBalance;
    const closingBalance = runningBalance + income - expenses;

    balances.set(dateKey, {
      date: dateKey,
      openingBalance,
      closingBalance,
      totalIncome: income,
      totalExpenses: expenses,
      projectedIncome: 0,
      projectedExpenses: 0,
      transactions: dayTransactions,
      status: getBalanceStatus(closingBalance, warningThreshold),
    });

    runningBalance = closingBalance;
  });

  return balances;
};

// ============================================================================
// BILL COVERAGE REPORT
// ============================================================================

export const getBillCoverageReport = (
  currentBalance: number,
  transactions: Transaction[],
  daysAhead: number = 14
): BillCoverageReport => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addDays(today, daysAhead);
  const todayStr = formatDate(today);
  const endDateStr = formatDate(endDate);

  // Filter transactions in the date range (exclude completed and skipped)
  const upcomingTransactions = transactions.filter((t) => {
    const date = t.actualDate || t.scheduledDate;
    return (
      date >= todayStr && date <= endDateStr && t.status !== "skipped" && t.status !== "completed"
    );
  });

  // Sort by date
  upcomingTransactions.sort((a, b) => {
    const dateA = a.actualDate || a.scheduledDate;
    const dateB = b.actualDate || b.scheduledDate;
    return dateA.localeCompare(dateB);
  });

  // Calculate coverage for each bill
  const upcomingBills: UpcomingBill[] = [];
  const billsAtRisk: UpcomingBill[] = [];
  let runningBalance = currentBalance;
  let totalBillsAmount = 0;

  upcomingTransactions.forEach((t) => {
    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      runningBalance += amount;
    } else {
      totalBillsAmount += amount;
      const balanceAfterBill = runningBalance - amount;
      const canCover = balanceAfterBill >= 0;
      const shortfall = canCover ? undefined : Math.abs(balanceAfterBill);

      const txDate = parseDate(t.scheduledDate);
      const daysUntilDue = Math.ceil((txDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const billInfo: UpcomingBill = {
        transaction: t,
        daysUntilDue,
        canCover,
        shortfall,
      };

      upcomingBills.push(billInfo);

      if (!canCover) {
        billsAtRisk.push(billInfo);
      }

      runningBalance = balanceAfterBill;
    }
  });

  const firstAtRisk = billsAtRisk[0];
  const firstShortfall = firstAtRisk
    ? {
        date: firstAtRisk.transaction.scheduledDate,
        amount: firstAtRisk.shortfall || 0,
        billName: firstAtRisk.transaction.name,
      }
    : undefined;

  return {
    currentBalance,
    upcomingBills,
    totalUpcoming: totalBillsAmount,
    projectedBalance: runningBalance,
    canCoverAll: billsAtRisk.length === 0,
    firstShortfall,
  };
};

// ============================================================================
// VARIANCE CALCULATION
// ============================================================================

export const calculateVarianceReport = (
  transactions: Transaction[],
  startDate: string,
  endDate: string
): VarianceReport => {
  // Filter completed transactions in date range
  const completedTransactions = transactions.filter(
    (t) => t.status === "completed" && t.scheduledDate >= startDate && t.scheduledDate <= endDate
  );

  // Calculate totals
  let projectedIncome = 0;
  let actualIncome = 0;
  let projectedExpenses = 0;
  let actualExpenses = 0;

  const categoryMap = new Map<string, { projected: number; actual: number }>();

  completedTransactions.forEach((t) => {
    const actual = t.actualAmount ?? t.projectedAmount;

    if (t.type === "income") {
      projectedIncome += t.projectedAmount;
      actualIncome += actual;
    } else {
      projectedExpenses += t.projectedAmount;
      actualExpenses += actual;

      // Track by category
      const existing = categoryMap.get(t.category) || { projected: 0, actual: 0 };
      existing.projected += t.projectedAmount;
      existing.actual += actual;
      categoryMap.set(t.category, existing);
    }
  });

  // Build category breakdown
  const byCategory = Array.from(categoryMap.entries()).map(([category, data]) => ({
    category,
    projected: data.projected,
    actual: data.actual,
    variance: data.actual - data.projected,
  }));

  // Calculate percentages
  const incomeVariance = actualIncome - projectedIncome;
  const incomeVariancePercent = projectedIncome > 0 ? (incomeVariance / projectedIncome) * 100 : 0;

  const expenseVariance = actualExpenses - projectedExpenses;
  const expenseVariancePercent =
    projectedExpenses > 0 ? (expenseVariance / projectedExpenses) * 100 : 0;

  return {
    period: { start: startDate, end: endDate },
    income: {
      projected: projectedIncome,
      actual: actualIncome,
      variance: incomeVariance,
      variancePercent: incomeVariancePercent,
    },
    expenses: {
      projected: projectedExpenses,
      actual: actualExpenses,
      variance: expenseVariance,
      variancePercent: expenseVariancePercent,
    },
    byCategory,
  };
};

// ============================================================================
// SUMMARY CALCULATIONS
// ============================================================================

export const calculateMonthlyTotals = (
  transactions: Transaction[],
  year: number,
  month: number
): { income: number; expenses: number; net: number } => {
  const startDate = formatDate(new Date(year, month, 1));
  const endDate = formatDate(new Date(year, month + 1, 0));

  let income = 0;
  let expenses = 0;

  transactions.forEach((t) => {
    const date = t.actualDate || t.scheduledDate;
    if (date < startDate || date > endDate) return;
    if (t.status === "skipped") return;

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
  };
};

export const getRunway = (
  currentBalance: number,
  transactions: Transaction[],
  maxDays: number = 365
): { days: number; runOutDate: string | null } => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let balance = currentBalance;
  let daysUntilEmpty = 0;
  let runOutDate: string | null = null;

  for (let i = 0; i < maxDays; i++) {
    const currentDate = addDays(today, i);
    const dateKey = formatDate(currentDate);

    // Find transactions for this day
    const dayTransactions = transactions.filter((t) => {
      const txDate = t.actualDate || t.scheduledDate;
      return txDate === dateKey && t.status !== "skipped";
    });

    dayTransactions.forEach((t) => {
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      if (t.type === "income") {
        balance += amount;
      } else {
        balance -= amount;
      }
    });

    if (balance < 0 && runOutDate === null) {
      runOutDate = dateKey;
      daysUntilEmpty = i;
      break;
    }
  }

  return {
    days: runOutDate ? daysUntilEmpty : maxDays,
    runOutDate,
  };
};

export const getNextCrunch = (
  currentBalance: number,
  transactions: Transaction[],
  maxDays: number = 90
): { date: string; shortfall: number } | null => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let balance = currentBalance;

  for (let i = 0; i < maxDays; i++) {
    const currentDate = addDays(today, i);
    const dateKey = formatDate(currentDate);

    const dayTransactions = transactions.filter((t) => {
      const txDate = t.actualDate || t.scheduledDate;
      return txDate === dateKey && t.status !== "skipped";
    });

    let dayExpenses = 0;
    let dayIncome = 0;

    dayTransactions.forEach((t) => {
      const amount =
        t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

      if (t.type === "income") {
        dayIncome += amount;
      } else {
        dayExpenses += amount;
      }
    });

    balance = balance + dayIncome - dayExpenses;

    if (dayExpenses > 0 && balance < 0) {
      return {
        date: dateKey,
        shortfall: Math.abs(balance),
      };
    }
  }

  return null;
};

// ============================================================================
// CATEGORY BREAKDOWN
// ============================================================================

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
