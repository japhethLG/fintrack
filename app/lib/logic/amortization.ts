export interface AmortizationStep {
  date: Date;
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
}

export interface LoanConfig {
  principal: number;
  annualRate: number; // e.g., 5.5 for 5.5%
  termMonths?: number;
  monthlyPayment?: number;
  startDate: Date;
}

export const calculateAmortizationSchedule = (config: LoanConfig): AmortizationStep[] => {
  const schedule: AmortizationStep[] = [];
  let balance = config.principal;
  const monthlyRate = config.annualRate / 100 / 12;

  // Calculate fixed monthly payment if not provided
  let payment = config.monthlyPayment || 0;
  if (!payment && config.termMonths) {
    // PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
    const n = config.termMonths;
    const r = monthlyRate;
    if (r === 0) {
      payment = balance / n;
    } else {
      payment = (balance * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
    }
  }

  const currentDate = new Date(config.startDate);

  // Safety limit to prevent infinite loops if payment < interest
  const maxMonths = config.termMonths || 360;

  for (let i = 0; i < maxMonths && balance > 0.01; i++) {
    const interest = balance * monthlyRate;
    let principal = payment - interest;

    // Handle final payment
    if (principal > balance) {
      principal = balance;
      payment = principal + interest;
    }

    // If payment is too low (negative amortization), cap principal at -interest?
    // Usually means debt grows. For now assume payment >= interest
    if (principal < 0) {
      // Just to avoid breaking
      principal = 0;
    }

    balance -= principal;

    schedule.push({
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: balance,
    });

    // Advance month
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return schedule;
};

export const calculateCreditCardProjection = (
  currentBalance: number,
  apr: number,
  minPaymentPercentage: number,
  monthsToProject: number = 12,
  startDate: Date,
  minPaymentFloor: number = 25,
  minPaymentMethod: "percent_only" | "percent_plus_interest" = "percent_only",
  dueDate?: number // Day of month for payments (1-31)
): AmortizationStep[] => {
  const schedule: AmortizationStep[] = [];
  let balance = currentBalance;
  const monthlyRate = apr / 100 / 12;
  const currentDate = new Date(startDate);

  // Set to the due date if provided
  if (dueDate) {
    currentDate.setDate(dueDate);
    // If the due date has already passed this month, start next month
    if (currentDate < startDate) {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  for (let i = 0; i < monthsToProject && balance > 0; i++) {
    const interest = balance * monthlyRate;

    // Calculate minimum payment based on method
    let payment: number;
    if (minPaymentMethod === "percent_plus_interest") {
      // Method: percentage of balance + monthly interest
      const percentPortion = balance * (minPaymentPercentage / 100);
      payment = Math.max(minPaymentFloor, percentPortion + interest);
    } else {
      // Method: percentage of balance only (default)
      payment = Math.max(minPaymentFloor, balance * (minPaymentPercentage / 100));
    }

    if (payment > balance + interest) {
      payment = balance + interest;
    }

    const principal = payment - interest;
    balance -= principal;

    schedule.push({
      date: new Date(currentDate),
      payment,
      principal,
      interest,
      remainingBalance: Math.max(0, balance),
    });

    currentDate.setMonth(currentDate.getMonth() + 1);
    // Ensure the day stays on the due date (handles month length differences)
    if (dueDate) {
      currentDate.setDate(dueDate);
    }
  }

  return schedule;
};
