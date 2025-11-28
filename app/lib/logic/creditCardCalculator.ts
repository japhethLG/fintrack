/**
 * Credit Card Payoff Calculator
 * Calculates detailed payoff projections for credit cards
 */

import { CreditConfig } from "@/lib/types";

export interface CreditCardPayoffSummary {
  // Payoff timeline
  payoffDate: Date | null; // null if never (minimum payment trap)
  monthsToPayoff: number;

  // Total costs
  totalAmountToPay: number;
  totalInterestToPay: number;

  // Current status
  currentMonthlyInterest: number;
  effectiveMonthlyPayment: number;

  // Progress (if tracking)
  principalPaidSoFar: number;
  interestPaidSoFar: number;

  // Comparison scenarios
  scenarios: PayoffScenario[];

  // Warning flags
  isMinimumPaymentTrap: boolean; // Payment barely covers interest
  yearsToPayoff: number;
}

export interface PayoffScenario {
  name: string;
  monthlyPayment: number;
  monthsToPayoff: number;
  totalInterest: number;
  totalAmount: number;
  interestSavings: number;
  timeSavingsMonths: number;
}

export interface MonthlyBreakdown {
  month: number;
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
}

/**
 * Calculate full payoff schedule for a credit card
 */
export const calculateCreditCardPayoff = (
  currentBalance: number,
  apr: number,
  monthlyPayment: number,
  startDate: Date = new Date(),
  maxMonths: number = 600 // 50 years max
): MonthlyBreakdown[] => {
  const schedule: MonthlyBreakdown[] = [];
  let balance = currentBalance;
  const monthlyRate = apr / 100 / 12;
  const currentDate = new Date(startDate);
  let cumulativeInterest = 0;
  let cumulativePrincipal = 0;

  for (let month = 1; month <= maxMonths && balance > 0.01; month++) {
    const interest = balance * monthlyRate;
    let payment = monthlyPayment;

    // Handle final payment
    if (payment > balance + interest) {
      payment = balance + interest;
    }

    // Check for negative amortization (payment doesn't cover interest)
    const principal = Math.max(0, payment - interest);
    balance = Math.max(0, balance - principal);

    cumulativeInterest += interest;
    cumulativePrincipal += principal;

    schedule.push({
      month,
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: balance,
      cumulativeInterest,
      cumulativePrincipal,
    });

    currentDate.setMonth(currentDate.getMonth() + 1);

    // Break if balance isn't decreasing (minimum payment trap)
    if (month > 12 && principal < 0.01) {
      break;
    }
  }

  return schedule;
};

/**
 * Calculate minimum payment based on credit card config
 */
export const calculateMinimumPayment = (config: CreditConfig): number => {
  const monthlyInterest = config.currentBalance * (config.apr / 100 / 12);

  if (config.minimumPaymentMethod === "percent_plus_interest") {
    const percentPortion = config.currentBalance * (config.minimumPaymentPercent / 100);
    return Math.max(config.minimumPaymentFloor, percentPortion + monthlyInterest);
  }

  return Math.max(
    config.minimumPaymentFloor,
    config.currentBalance * (config.minimumPaymentPercent / 100)
  );
};

/**
 * Get the effective payment amount based on strategy
 */
export const getEffectivePayment = (config: CreditConfig): number => {
  switch (config.paymentStrategy) {
    case "fixed":
      return config.fixedPaymentAmount || calculateMinimumPayment(config);
    case "full_balance":
      return config.currentBalance;
    case "minimum":
    default:
      return calculateMinimumPayment(config);
  }
};

/**
 * Calculate comprehensive payoff summary
 */
export const calculatePayoffSummary = (
  config: CreditConfig,
  principalPaidSoFar: number = 0,
  interestPaidSoFar: number = 0
): CreditCardPayoffSummary => {
  const effectivePayment = getEffectivePayment(config);
  const currentMonthlyInterest = config.currentBalance * (config.apr / 100 / 12);

  // Calculate payoff with current strategy
  const schedule = calculateCreditCardPayoff(
    config.currentBalance,
    config.apr,
    effectivePayment
  );

  const lastPayment = schedule[schedule.length - 1];
  const willPayOff = lastPayment && lastPayment.remainingBalance < 0.01;

  // Check for minimum payment trap
  const isMinimumPaymentTrap = effectivePayment <= currentMonthlyInterest * 1.1;

  // Calculate comparison scenarios
  const scenarios = calculatePayoffScenarios(config, schedule);

  return {
    payoffDate: willPayOff ? lastPayment.date : null,
    monthsToPayoff: willPayOff ? schedule.length : Infinity,
    totalAmountToPay: willPayOff
      ? schedule.reduce((sum, m) => sum + m.payment, 0)
      : Infinity,
    totalInterestToPay: willPayOff
      ? lastPayment.cumulativeInterest
      : Infinity,
    currentMonthlyInterest,
    effectiveMonthlyPayment: effectivePayment,
    principalPaidSoFar,
    interestPaidSoFar,
    scenarios,
    isMinimumPaymentTrap,
    yearsToPayoff: willPayOff ? schedule.length / 12 : Infinity,
  };
};

/**
 * Calculate different payment scenarios for comparison
 */
const calculatePayoffScenarios = (
  config: CreditConfig,
  currentSchedule: MonthlyBreakdown[]
): PayoffScenario[] => {
  const scenarios: PayoffScenario[] = [];
  const currentMonths = currentSchedule.length;
  const currentInterest = currentSchedule[currentSchedule.length - 1]?.cumulativeInterest || 0;
  const currentTotal = currentSchedule.reduce((sum, m) => sum + m.payment, 0);

  // Scenario: Double payment
  const doublePayment = getEffectivePayment(config) * 2;
  const doubleSchedule = calculateCreditCardPayoff(
    config.currentBalance,
    config.apr,
    doublePayment
  );
  if (doubleSchedule.length > 0 && doubleSchedule[doubleSchedule.length - 1].remainingBalance < 0.01) {
    scenarios.push({
      name: "Double Payment",
      monthlyPayment: doublePayment,
      monthsToPayoff: doubleSchedule.length,
      totalInterest: doubleSchedule[doubleSchedule.length - 1].cumulativeInterest,
      totalAmount: doubleSchedule.reduce((sum, m) => sum + m.payment, 0),
      interestSavings: currentInterest - doubleSchedule[doubleSchedule.length - 1].cumulativeInterest,
      timeSavingsMonths: currentMonths - doubleSchedule.length,
    });
  }

  // Scenario: Pay off in 12 months
  const twelveMonthPayment = calculatePaymentForMonths(config.currentBalance, config.apr, 12);
  if (twelveMonthPayment > 0) {
    const twelveSchedule = calculateCreditCardPayoff(
      config.currentBalance,
      config.apr,
      twelveMonthPayment
    );
    if (twelveSchedule.length > 0) {
      scenarios.push({
        name: "Pay Off in 1 Year",
        monthlyPayment: twelveMonthPayment,
        monthsToPayoff: twelveSchedule.length,
        totalInterest: twelveSchedule[twelveSchedule.length - 1].cumulativeInterest,
        totalAmount: twelveSchedule.reduce((sum, m) => sum + m.payment, 0),
        interestSavings: currentInterest - twelveSchedule[twelveSchedule.length - 1].cumulativeInterest,
        timeSavingsMonths: currentMonths - twelveSchedule.length,
      });
    }
  }

  // Scenario: Pay off in 24 months
  const twentyFourMonthPayment = calculatePaymentForMonths(config.currentBalance, config.apr, 24);
  if (twentyFourMonthPayment > 0 && twentyFourMonthPayment < doublePayment) {
    const twentyFourSchedule = calculateCreditCardPayoff(
      config.currentBalance,
      config.apr,
      twentyFourMonthPayment
    );
    if (twentyFourSchedule.length > 0) {
      scenarios.push({
        name: "Pay Off in 2 Years",
        monthlyPayment: twentyFourMonthPayment,
        monthsToPayoff: twentyFourSchedule.length,
        totalInterest: twentyFourSchedule[twentyFourSchedule.length - 1].cumulativeInterest,
        totalAmount: twentyFourSchedule.reduce((sum, m) => sum + m.payment, 0),
        interestSavings: currentInterest - twentyFourSchedule[twentyFourSchedule.length - 1].cumulativeInterest,
        timeSavingsMonths: currentMonths - twentyFourSchedule.length,
      });
    }
  }

  return scenarios.filter(s => s.interestSavings > 0).sort((a, b) => a.monthlyPayment - b.monthlyPayment);
};

/**
 * Calculate the monthly payment needed to pay off in X months
 */
export const calculatePaymentForMonths = (
  balance: number,
  apr: number,
  months: number
): number => {
  const monthlyRate = apr / 100 / 12;

  if (monthlyRate === 0) {
    return balance / months;
  }

  // PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
  const payment = (balance * (monthlyRate * Math.pow(1 + monthlyRate, months))) /
                  (Math.pow(1 + monthlyRate, months) - 1);

  return Math.ceil(payment * 100) / 100; // Round up to nearest cent
};

/**
 * Format months as years and months string
 */
export const formatPayoffTime = (months: number): string => {
  if (!isFinite(months)) return "Never (payment too low)";

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
  }

  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }

  return `${years} year${years !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
};

