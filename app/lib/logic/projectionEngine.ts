import {
  IncomeSource,
  ExpenseRule,
  Transaction,
  TransactionType,
  IncomeFrequency,
  ScheduleConfig,
  PaymentBreakdown,
} from "@/lib/types";
import {
  calculateAmortizationSchedule,
  calculateCreditCardProjection,
  AmortizationStep,
} from "./amortization";
import { parseDate, formatDate, addDays, addWeeks, addMonths } from "@/lib/utils/dateUtils";

// ============================================================================
// DATE UTILITIES
// ============================================================================

const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

const adjustForWeekend = (date: Date, adjustment: "before" | "after" | "none"): Date => {
  if (adjustment === "none") return date;

  const day = date.getDay();
  if (day === 0) {
    // Sunday
    return adjustment === "before" ? addDays(date, -2) : addDays(date, 1);
  }
  if (day === 6) {
    // Saturday
    return adjustment === "before" ? addDays(date, -1) : addDays(date, 2);
  }
  return date;
};

const getLastDayOfMonth = (year: number, month: number): number => {
  return new Date(year, month + 1, 0).getDate();
};

const clampDayToMonth = (day: number, year: number, month: number): number => {
  const maxDay = getLastDayOfMonth(year, month);
  return Math.min(day, maxDay);
};

// ============================================================================
// OCCURRENCE CALCULATION
// ============================================================================

interface OccurrenceParams {
  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;
  scheduleConfig: ScheduleConfig;
  weekendAdjustment: "before" | "after" | "none";
}

const calculateOccurrences = (
  params: OccurrenceParams,
  viewStartDate: Date,
  viewEndDate: Date
): Date[] => {
  const occurrences: Date[] = [];
  const start = parseDate(params.startDate);
  const end = params.endDate ? parseDate(params.endDate) : viewEndDate;
  const effectiveEnd = end < viewEndDate ? end : viewEndDate;

  if (start > effectiveEnd) return [];

  switch (params.frequency) {
    case "one-time": {
      if (start >= viewStartDate && start <= effectiveEnd) {
        occurrences.push(adjustForWeekend(start, params.weekendAdjustment));
      }
      break;
    }

    case "daily": {
      let current = new Date(Math.max(start.getTime(), viewStartDate.getTime()));
      while (current <= effectiveEnd) {
        occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        current = addDays(current, 1);
      }
      break;
    }

    case "weekly": {
      // Start from the first occurrence on or after viewStartDate
      let current = new Date(start);

      // Find the first occurrence
      if (params.scheduleConfig.dayOfWeek !== undefined) {
        const targetDay = params.scheduleConfig.dayOfWeek;
        while (current.getDay() !== targetDay) {
          current = addDays(current, 1);
        }
      }

      while (current <= effectiveEnd) {
        if (current >= viewStartDate) {
          occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        }
        current = addWeeks(current, 1);
      }
      break;
    }

    case "bi-weekly": {
      const intervalWeeks = params.scheduleConfig.intervalWeeks || 2;
      let current = new Date(start);

      // Align to correct day if specified
      if (params.scheduleConfig.dayOfWeek !== undefined) {
        const targetDay = params.scheduleConfig.dayOfWeek;
        while (current.getDay() !== targetDay) {
          current = addDays(current, 1);
        }
      }

      while (current <= effectiveEnd) {
        if (current >= viewStartDate) {
          occurrences.push(adjustForWeekend(new Date(current), params.weekendAdjustment));
        }
        current = addWeeks(current, intervalWeeks);
      }
      break;
    }

    case "semi-monthly": {
      // Specific dates like 15th and 30th
      const specificDays = params.scheduleConfig.specificDays || [15, 30];
      let monthCursor = new Date(start);
      monthCursor.setDate(1); // Start from beginning of month

      while (monthCursor <= effectiveEnd) {
        const year = monthCursor.getFullYear();
        const month = monthCursor.getMonth();

        specificDays.forEach((day) => {
          const actualDay = clampDayToMonth(day, year, month);
          const date = new Date(year, month, actualDay);

          if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
            occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
          }
        });

        monthCursor = addMonths(monthCursor, 1);
      }
      break;
    }

    case "monthly": {
      const dayOfMonth = params.scheduleConfig.dayOfMonth || start.getDate();
      let monthCursor = new Date(start);

      while (monthCursor <= effectiveEnd) {
        const year = monthCursor.getFullYear();
        const month = monthCursor.getMonth();
        const actualDay = clampDayToMonth(dayOfMonth, year, month);
        const date = new Date(year, month, actualDay);

        // Must be on or after the start date, within view window, and before end
        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        monthCursor = addMonths(monthCursor, 1);
      }
      break;
    }

    case "quarterly": {
      const monthOfYear = params.scheduleConfig.monthOfYear;
      const dayOfMonth = params.scheduleConfig.dayOfMonth || 1;
      let current = new Date(start);

      while (current <= effectiveEnd) {
        const year = current.getFullYear();
        const month = current.getMonth();
        const actualDay = clampDayToMonth(dayOfMonth, year, month);
        const date = new Date(year, month, actualDay);

        // Must be on or after the start date, within view window, and before end
        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        current = addMonths(current, 3);
      }
      break;
    }

    case "yearly": {
      const monthOfYear = params.scheduleConfig.monthOfYear || start.getMonth();
      const dayOfMonth = params.scheduleConfig.dayOfMonth || start.getDate();
      let yearCursor = start.getFullYear();

      while (yearCursor <= effectiveEnd.getFullYear()) {
        const actualDay = clampDayToMonth(dayOfMonth, yearCursor, monthOfYear);
        const date = new Date(yearCursor, monthOfYear, actualDay);

        if (date >= start && date >= viewStartDate && date <= effectiveEnd) {
          occurrences.push(adjustForWeekend(date, params.weekendAdjustment));
        }

        yearCursor++;
      }
      break;
    }
  }

  return occurrences;
};

// ============================================================================
// PROJECTION GENERATION
// ============================================================================

const createProjectedTransaction = (
  source: IncomeSource | ExpenseRule,
  date: Date,
  type: TransactionType,
  sourceType: "income_source" | "expense_rule",
  paymentBreakdown?: PaymentBreakdown
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> => {
  const amount = paymentBreakdown?.principalPaid
    ? paymentBreakdown.principalPaid + paymentBreakdown.interestPaid
    : source.amount;

  return {
    name: source.name,
    type,
    category: source.category,
    sourceType,
    sourceId: source.id,
    projectedAmount: amount,
    scheduledDate: formatDate(date),
    status: "projected",
    paymentBreakdown,
  };
};

const generateIncomeProjections = (
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

  return occurrences.map((date) =>
    createProjectedTransaction(source, date, "income", "income_source")
  );
};

const generateExpenseProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.isActive) return [];

  // Handle loan payments with amortization
  if (rule.expenseType === "cash_loan" && rule.loanConfig) {
    return generateLoanProjections(rule, viewStartDate, viewEndDate);
  }

  // Handle credit card payments
  if (rule.expenseType === "credit_card" && rule.creditConfig) {
    return generateCreditProjections(rule, viewStartDate, viewEndDate);
  }

  // Handle installment payments
  if (rule.expenseType === "installment" && rule.installmentConfig) {
    return generateInstallmentProjections(rule, viewStartDate, viewEndDate);
  }

  // Standard recurring expenses
  const occurrences = calculateOccurrences(
    {
      frequency: rule.frequency,
      startDate: rule.startDate,
      endDate: rule.endDate,
      scheduleConfig: rule.scheduleConfig,
      weekendAdjustment: rule.weekendAdjustment,
    },
    viewStartDate,
    viewEndDate
  );

  return occurrences.map((date) =>
    createProjectedTransaction(rule, date, "expense", "expense_rule")
  );
};

const generateLoanProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.loanConfig) return [];

  const { loanConfig } = rule;

  // Calculate remaining payments from current state
  const remainingPayments = loanConfig.termMonths - loanConfig.paymentsMade;
  if (remainingPayments <= 0) return [];

  // Generate amortization schedule starting from current balance
  const schedule = calculateAmortizationSchedule({
    principal: loanConfig.currentBalance,
    annualRate: loanConfig.interestRate,
    termMonths: remainingPayments,
    startDate: parseDate(rule.startDate),
  });

  // Filter to view period and map to transactions
  return schedule
    .filter((step) => step.date >= viewStartDate && step.date <= viewEndDate)
    .map((step, index) => {
      const paymentNumber = loanConfig.paymentsMade + index + 1;

      return createProjectedTransaction(
        { ...rule, amount: step.payment },
        step.date,
        "expense",
        "expense_rule",
        {
          principalPaid: step.principal,
          interestPaid: step.interest,
          remainingBalance: step.remainingBalance,
          paymentNumber,
          totalPayments: loanConfig.termMonths,
        }
      );
    });
};

const generateCreditProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.creditConfig) return [];

  const { creditConfig } = rule;

  if (creditConfig.currentBalance <= 0) return [];

  // Calculate payment amount based on strategy
  let paymentAmount: number;
  const monthlyInterest = creditConfig.currentBalance * (creditConfig.apr / 100 / 12);

  switch (creditConfig.paymentStrategy) {
    case "minimum":
      if (creditConfig.minimumPaymentMethod === "percent_plus_interest") {
        // Method: percentage of balance + monthly interest
        const percentPortion =
          creditConfig.currentBalance * (creditConfig.minimumPaymentPercent / 100);
        paymentAmount = Math.max(
          creditConfig.minimumPaymentFloor,
          percentPortion + monthlyInterest
        );
      } else {
        // Method: percentage of balance only (default)
        paymentAmount = Math.max(
          creditConfig.minimumPaymentFloor,
          creditConfig.currentBalance * (creditConfig.minimumPaymentPercent / 100)
        );
      }
      break;
    case "fixed":
      paymentAmount = creditConfig.fixedPaymentAmount || creditConfig.minimumPaymentFloor;
      break;
    case "full_balance":
      paymentAmount = creditConfig.currentBalance;
      break;
  }

  // Generate credit card projection
  const schedule = calculateCreditCardProjection(
    creditConfig.currentBalance,
    creditConfig.apr,
    creditConfig.minimumPaymentPercent,
    12, // Project 12 months
    parseDate(rule.startDate),
    creditConfig.minimumPaymentFloor,
    creditConfig.minimumPaymentMethod || "percent_only",
    creditConfig.dueDate // Use due date for payment day
  );

  // Override payment amounts if using fixed or full balance strategy
  if (creditConfig.paymentStrategy !== "minimum") {
    // Recalculate with fixed payment
    let balance = creditConfig.currentBalance;
    const monthlyRate = creditConfig.apr / 100 / 12;
    const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];

    let currentDate = parseDate(rule.startDate);
    currentDate.setDate(creditConfig.dueDate);

    let paymentNum = 1;
    while (balance > 0 && currentDate <= viewEndDate) {
      if (currentDate >= viewStartDate) {
        const interest = balance * monthlyRate;
        const actualPayment = Math.min(paymentAmount, balance + interest);
        const principal = actualPayment - interest;

        projections.push(
          createProjectedTransaction(
            { ...rule, amount: actualPayment },
            currentDate,
            "expense",
            "expense_rule",
            {
              principalPaid: principal,
              interestPaid: interest,
              remainingBalance: Math.max(0, balance - principal),
              paymentNumber: paymentNum,
              totalPayments: 0, // Unknown for credit cards
            }
          )
        );

        balance = Math.max(0, balance - principal);
        paymentNum++;
      }

      currentDate = addMonths(currentDate, 1);
    }

    return projections;
  }

  // Use minimum payment schedule
  return schedule
    .filter((step) => step.date >= viewStartDate && step.date <= viewEndDate)
    .map((step, index) =>
      createProjectedTransaction(
        { ...rule, amount: step.payment },
        step.date,
        "expense",
        "expense_rule",
        {
          principalPaid: step.principal,
          interestPaid: step.interest,
          remainingBalance: step.remainingBalance,
          paymentNumber: index + 1,
          totalPayments: 0,
        }
      )
    );
};

const generateInstallmentProjections = (
  rule: ExpenseRule,
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  if (!rule.installmentConfig) return [];

  const { installmentConfig } = rule;

  const remainingInstallments =
    installmentConfig.installmentCount - installmentConfig.installmentsPaid;
  if (remainingInstallments <= 0) return [];

  const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];
  let currentDate = parseDate(rule.startDate);

  // Skip already paid installments
  for (let i = 0; i < installmentConfig.installmentsPaid; i++) {
    currentDate = addMonths(currentDate, 1);
  }

  for (let i = 0; i < remainingInstallments; i++) {
    if (currentDate > viewEndDate) break;

    if (currentDate >= viewStartDate) {
      const adjustedDate = adjustForWeekend(currentDate, rule.weekendAdjustment);
      const paymentNumber = installmentConfig.installmentsPaid + i + 1;

      projections.push(
        createProjectedTransaction(
          { ...rule, amount: installmentConfig.installmentAmount },
          adjustedDate,
          "expense",
          "expense_rule",
          {
            principalPaid: installmentConfig.installmentAmount,
            interestPaid: 0,
            remainingBalance:
              (installmentConfig.installmentCount - paymentNumber) *
              installmentConfig.installmentAmount,
            paymentNumber,
            totalPayments: installmentConfig.installmentCount,
          }
        )
      );
    }

    currentDate = addMonths(currentDate, 1);
  }

  return projections;
};

// ============================================================================
// MAIN EXPORT
// ============================================================================

export const generateProjections = (
  incomeSources: IncomeSource[],
  expenseRules: ExpenseRule[],
  viewStartDate: Date,
  viewEndDate: Date
): Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] => {
  const projections: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[] = [];

  // Generate income projections
  incomeSources.forEach((source) => {
    const incomeProjections = generateIncomeProjections(source, viewStartDate, viewEndDate);
    projections.push(...incomeProjections);
  });

  // Generate expense projections
  expenseRules.forEach((rule) => {
    const expenseProjections = generateExpenseProjections(rule, viewStartDate, viewEndDate);
    projections.push(...expenseProjections);
  });

  // Sort by date
  projections.sort(
    (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
  );

  return projections;
};

// Export utilities for testing
export { calculateOccurrences, adjustForWeekend };
