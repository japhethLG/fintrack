import { Timestamp } from "firebase/firestore";

// ============================================================================
// USER PROFILE
// ============================================================================

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  profilePictureUrl?: string;
  currentBalance: number;
  initialBalance: number;
  balanceLastUpdatedAt: string;
  /**
   * Version of the balance model this profile's numbers follow. From version 1 on,
   * `currentBalance == initialBalance + SUM(signed(completed stored rows))` holds and
   * is maintained atomically with every change to a stored row. A profile without it
   * is rebased once (see migrateToInitialBalance); absent on legacy documents.
   */
  balanceModelVersion?: number;
  /**
   * Version of the schedule data this profile's rules follow. From version 1 on, a loan or
   * installment rule's `scheduleConfig.dayOfMonth` is a day the USER chose (the engine pays on
   * it). Older rules carry a hidden day the old form saved (the day of creation) which the old
   * engine ignored; the one-time migration sets it to the start date's day so nothing moves.
   */
  scheduleModelVersion?: number;
  preferences: {
    currency: string;
    dateFormat: string;
    startOfWeek: 0 | 1;
    theme: "dark" | "light";
    defaultWarningThreshold: number;
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// INCOME SOURCES
// ============================================================================

export type IncomeSourceType =
  | "salary"
  | "freelance"
  | "business"
  | "investment"
  | "rental"
  | "government"
  | "gift"
  | "other";

export type IncomeFrequency =
  | "one-time"
  | "daily"
  | "weekly"
  | "bi-weekly"
  | "semi-monthly"
  | "monthly"
  | "quarterly"
  | "yearly";

export interface IncomeSource {
  id: string;
  userId: string;
  name: string;
  sourceType: IncomeSourceType;
  amount: number;
  isVariableAmount: boolean;

  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;

  scheduleConfig: ScheduleConfig;

  weekendAdjustment: "before" | "after" | "none";

  category: string;
  notes?: string;
  color?: string;
  isActive: boolean;
  occurrenceOverrides?: Record<string, OccurrenceOverride>;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// EXPENSE RULES
// ============================================================================

export type ExpenseType =
  | "fixed"
  | "variable"
  | "cash_loan"
  | "credit_card"
  | "installment"
  | "one-time";

export type ExpenseCategory =
  | "housing"
  | "utilities"
  | "transportation"
  | "groceries"
  | "dining"
  | "entertainment"
  | "healthcare"
  | "insurance"
  | "debt_payment"
  | "subscriptions"
  | "education"
  | "personal"
  | "savings"
  | "other";

export type LoanCalculationType = "amortized" | "flat_rate" | "reducing_balance";
export type CreditPaymentStrategy = "minimum" | "fixed" | "full_balance";

export interface LoanConfig {
  principalAmount: number;
  currentBalance: number;
  interestRate: number;
  termMonths: number;
  monthlyPayment: number;
  calculationType: LoanCalculationType;
  loanStartDate: string;
  firstPaymentDate: string;
  paymentsMade: number;
}

export type MinimumPaymentMethod = "percent_only" | "percent_plus_interest";

export interface CreditConfig {
  creditLimit: number;
  currentBalance: number;
  apr: number;
  minimumPaymentPercent: number;
  minimumPaymentFloor: number;
  minimumPaymentMethod: MinimumPaymentMethod;
  statementDate: number;
  dueDate: number;
  paymentStrategy: CreditPaymentStrategy;
  fixedPaymentAmount?: number;
  /**
   * Payments completed against the balance above, maintained by the write path (+1 per completed
   * payment, -1 when it is reverted/skipped/deleted). The payoff schedule is built from the
   * CURRENT balance, so it must start after the payments already made: without this the month
   * just paid takes the first slot of the new schedule and the next bill shrinks (1,000 at 0%,
   * 400 paid: schedule 400, 200 instead of 400, 200 for the REMAINING 600 starting next month).
   */
  paymentsMade?: number;
}

export interface InstallmentConfig {
  totalAmount: number;
  installmentCount: number;
  installmentAmount: number;
  installmentsPaid: number;
  hasInterest: boolean;
  interestRate?: number;
}

export interface ScheduleConfig {
  specificDays?: number[];
  dayOfWeek?: number;
  dayOfMonth?: number;
  intervalWeeks?: number;
  monthOfYear?: number;
}

export interface ExpenseRule {
  id: string;
  userId: string;
  name: string;
  expenseType: ExpenseType;
  category: ExpenseCategory;

  amount: number;
  isVariableAmount: boolean;

  frequency: IncomeFrequency;
  startDate: string;
  endDate?: string;

  scheduleConfig: ScheduleConfig;

  weekendAdjustment: "before" | "after" | "none";

  loanConfig?: LoanConfig;
  creditConfig?: CreditConfig;
  installmentConfig?: InstallmentConfig;

  notes?: string;
  color?: string;
  isActive: boolean;
  isPriority: boolean;
  occurrenceOverrides?: Record<string, OccurrenceOverride>;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// TRANSACTIONS
// ============================================================================

export type TransactionType = "income" | "expense";
export type TransactionStatus = "projected" | "completed" | "skipped";

export interface PaymentBreakdown {
  principalPaid: number;
  interestPaid: number;
  remainingBalance: number;
  paymentNumber: number;
  totalPayments: number;
}

export interface Transaction {
  id: string;
  userId: string;

  sourceType: "income_source" | "expense_rule" | "manual";
  sourceId?: string;

  name: string;
  type: TransactionType;
  category: string;

  projectedAmount: number;
  actualAmount?: number;
  variance?: number;

  scheduledDate: string;
  actualDate?: string;

  status: TransactionStatus;
  occurrenceId?: string;

  paymentBreakdown?: PaymentBreakdown;

  notes?: string;
  attachments?: string[];

  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp;
}

// ============================================================================
// BALANCE HISTORY
// ============================================================================

export interface BalanceSnapshot {
  id: string;
  userId: string;
  date: string;

  openingBalance: number;
  closingBalance: number;

  totalIncome: number;
  totalExpenses: number;

  projectedIncome: number;
  projectedExpenses: number;

  isReconciled: boolean;

  createdAt: Timestamp;
}

// ============================================================================
// ALERTS
// ============================================================================

export type AlertType =
  | "insufficient_funds"
  | "low_balance"
  | "missed_transaction"
  | "payment_due"
  | "bill_reminder";

export type AlertSeverity = "info" | "warning" | "danger";

export interface Alert {
  id: string;
  userId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  actionText?: string;
  actionUrl?: string;
  isRead: boolean;
  isDismissed: boolean;
  createdAt: Timestamp;
}

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

export type DeletableDataType =
  | "income_sources"
  | "expense_rules"
  | "transactions"
  | "balance_history"
  | "alerts";

// ============================================================================
// COMPUTED/DERIVED DATA
// ============================================================================

export type BalanceStatus = "safe" | "warning" | "danger";

export interface DayBalance {
  date: string;
  openingBalance: number;
  closingBalance: number;
  totalIncome: number;
  totalExpenses: number;
  /**
   * What actually MOVED the balance this day: closing = opening + movedIncome - movedExpenses
   * - overdueOwed. Equals totalIncome / totalExpenses except for a completed row dated after today
   * (paid ahead of its date): that row is listed on its own day but its money moved on today.
   * Absent (hand-built days): the same as totalIncome / totalExpenses.
   */
  movedIncome?: number;
  movedExpenses?: number;
  projectedIncome: number;
  projectedExpenses: number;
  transactions: Transaction[];
  status: BalanceStatus;
  /** Set on TODAY only: completed rows listed on a LATER day whose money moved today (paid ahead). */
  paidAhead?: Transaction[];
  /**
   * Set on TODAY only: the sum of overdue, still-projected expenses that were deducted from this
   * day's closing balance (they do not move the realized balance, see balanceCalculator/openItems.ts).
   */
  overdueOwed?: number;
}

export interface UpcomingBill {
  transaction: Transaction;
  daysUntilDue: number;
  canCover: boolean;
  shortfall?: number;
}

export interface BillCoverageReport {
  currentBalance: number;
  upcomingBills: UpcomingBill[];
  totalUpcoming: number;
  projectedBalance: number;
  canCoverAll: boolean;
  firstShortfall?: {
    date: string;
    amount: number;
    billName: string;
  };
}

export interface MonthlyStats {
  income: number;
  expenses: number;
  balance: number;
  transactions: number;
}

export interface ForecastData {
  date: string;
  balance: number;
}

export interface VarianceReport {
  period: { start: string; end: string };
  income: {
    projected: number;
    actual: number;
    variance: number;
    variancePercent: number;
  };
  expenses: {
    projected: number;
    actual: number;
    variance: number;
    variancePercent: number;
  };
  byCategory: Array<{
    category: string;
    projected: number;
    actual: number;
    variance: number;
  }>;
}

// ============================================================================
// FORM DATA TYPES
// ============================================================================

export type IncomeSourceFormData = Omit<IncomeSource, "id" | "userId" | "createdAt" | "updatedAt">;

export type ExpenseRuleFormData = Omit<ExpenseRule, "id" | "userId" | "createdAt" | "updatedAt">;

export interface ManualTransactionFormData {
  name: string;
  type: TransactionType;
  category: string;
  amount: number;
  scheduledDate: string;
  status: TransactionStatus;
  notes?: string;
}

export interface CompleteTransactionData {
  actualAmount: number;
  actualDate?: string;
  notes?: string;
}

export interface OccurrenceOverride {
  scheduledDate?: string;
  amount?: number;
  skipped?: boolean;
  notes?: string;
}

// Legacy types for backward compatibility
export interface IncomeRule {
  id: string;
  name: string;
  amount: number;
  frequency: "weekly" | "bi-weekly" | "monthly-dates" | "monthly-specific";
  specificDates?: number[];
  weekendAdjustment: "before" | "after" | "none";
}
