import type { Timestamp } from "firebase/firestore";
import type {
  CreditConfig,
  ExpenseRule,
  IncomeSource,
  InstallmentConfig,
  LoanConfig,
  OccurrenceOverride,
  PaymentBreakdown,
  Transaction,
  UserProfile,
} from "@/lib/types";

/**
 * Fixture builders.
 *
 * Every builder returns a complete, valid entity with neutral defaults and
 * accepts a partial override. Defaults are chosen to be boring on purpose:
 * monthly frequency, no weekend adjustment, active, round amounts. A test that
 * cares about a field sets that field, so the intent of each test is visible in
 * its overrides rather than buried in a fixture.
 *
 * Anchor date for all defaults is 2026-01-01 (a Thursday).
 */

/**
 * Stand-in for a Firestore Timestamp. The engine only ever passes these
 * through, never reads them, so a structural fake is sufficient and avoids
 * pulling the Firebase SDK into pure-logic tests.
 */
export const fakeTimestamp = (millis = 0): Timestamp =>
  ({
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1e6,
    toMillis: () => millis,
    toDate: () => new Date(millis),
    isEqual: (other: { seconds: number }) => other?.seconds === Math.floor(millis / 1000),
  }) as unknown as Timestamp;

const TS = fakeTimestamp(0);

// ============================================================================
// USER
// ============================================================================

export const makeUserProfile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  uid: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  currentBalance: 10_000,
  initialBalance: 10_000,
  balanceLastUpdatedAt: "2026-01-01",
  preferences: {
    currency: "USD",
    dateFormat: "YYYY-MM-DD",
    startOfWeek: 0,
    theme: "dark",
    defaultWarningThreshold: 500,
    ...(overrides.preferences ?? {}),
  },
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

// ============================================================================
// INCOME
// ============================================================================

export const makeIncomeSource = (overrides: Partial<IncomeSource> = {}): IncomeSource => ({
  id: "inc-1",
  userId: "user-1",
  name: "Salary",
  sourceType: "salary",
  amount: 3_000,
  isVariableAmount: false,
  frequency: "monthly",
  startDate: "2026-01-01",
  scheduleConfig: {},
  weekendAdjustment: "none",
  category: "salary",
  isActive: true,
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

// ============================================================================
// EXPENSE
// ============================================================================

export const makeExpenseRule = (overrides: Partial<ExpenseRule> = {}): ExpenseRule => ({
  id: "exp-1",
  userId: "user-1",
  name: "Rent",
  expenseType: "fixed",
  category: "housing",
  amount: 1_200,
  isVariableAmount: false,
  frequency: "monthly",
  startDate: "2026-01-01",
  scheduleConfig: {},
  weekendAdjustment: "none",
  isActive: true,
  isPriority: false,
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

/** Amortized cash loan: 12,000 over 24 months at 12% APR. */
export const makeLoanConfig = (overrides: Partial<LoanConfig> = {}): LoanConfig => ({
  principalAmount: 12_000,
  currentBalance: 12_000,
  interestRate: 12,
  termMonths: 24,
  monthlyPayment: 565.0,
  calculationType: "amortized",
  loanStartDate: "2026-01-01",
  firstPaymentDate: "2026-01-01",
  paymentsMade: 0,
  ...overrides,
});

/** Revolving card: 5,000 at 24% APR, 2%/25 minimum, due on the 15th. */
export const makeCreditConfig = (overrides: Partial<CreditConfig> = {}): CreditConfig => ({
  creditLimit: 10_000,
  currentBalance: 5_000,
  apr: 24,
  minimumPaymentPercent: 2,
  minimumPaymentFloor: 25,
  minimumPaymentMethod: "percent_only",
  statementDate: 1,
  dueDate: 15,
  paymentStrategy: "minimum",
  ...overrides,
});

/** 0% BNPL plan: 6 x 200. */
export const makeInstallmentConfig = (
  overrides: Partial<InstallmentConfig> = {}
): InstallmentConfig => ({
  totalAmount: 1_200,
  installmentCount: 6,
  installmentAmount: 200,
  installmentsPaid: 0,
  hasInterest: false,
  ...overrides,
});

/** Expense rule pre-wired as a cash loan. */
export const makeLoanRule = (
  overrides: Partial<ExpenseRule> = {},
  loanOverrides: Partial<LoanConfig> = {}
): ExpenseRule =>
  makeExpenseRule({
    id: "loan-1",
    name: "Car Loan",
    expenseType: "cash_loan",
    category: "debt_payment",
    amount: 565,
    loanConfig: makeLoanConfig(loanOverrides),
    ...overrides,
  });

/** Expense rule pre-wired as a credit card. */
export const makeCreditRule = (
  overrides: Partial<ExpenseRule> = {},
  creditOverrides: Partial<CreditConfig> = {}
): ExpenseRule =>
  makeExpenseRule({
    id: "card-1",
    name: "Visa",
    expenseType: "credit_card",
    category: "debt_payment",
    amount: 100,
    creditConfig: makeCreditConfig(creditOverrides),
    ...overrides,
  });

/** Expense rule pre-wired as an installment plan. */
export const makeInstallmentRule = (
  overrides: Partial<ExpenseRule> = {},
  installmentOverrides: Partial<InstallmentConfig> = {}
): ExpenseRule =>
  makeExpenseRule({
    id: "inst-1",
    name: "Laptop BNPL",
    expenseType: "installment",
    category: "personal",
    amount: 200,
    installmentConfig: makeInstallmentConfig(installmentOverrides),
    ...overrides,
  });

// ============================================================================
// TRANSACTIONS
// ============================================================================

export const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "txn-1",
  userId: "user-1",
  sourceType: "manual",
  name: "Transaction",
  type: "expense",
  category: "other",
  projectedAmount: 100,
  scheduledDate: "2026-01-15",
  status: "projected",
  createdAt: TS,
  updatedAt: TS,
  ...overrides,
});

/**
 * A projected (not yet realized) transaction, shaped the way the merger emits
 * one: deterministic `proj_` id, rule-derived source fields.
 */
export const makeProjectedTransaction = (overrides: Partial<Transaction> = {}): Transaction => {
  const base = makeTransaction({
    sourceType: "expense_rule",
    sourceId: "exp-1",
    status: "projected",
    ...overrides,
  });
  return {
    ...base,
    id: overrides.id ?? `proj_${base.sourceId}::${base.scheduledDate}::${base.occurrenceId ?? ""}`,
  };
};

/**
 * A completed transaction. `actualAmount` defaults to `projectedAmount` (zero
 * variance) so tests that care about variance set it explicitly.
 */
export const makeCompletedTransaction = (overrides: Partial<Transaction> = {}): Transaction => {
  const projectedAmount = overrides.projectedAmount ?? 100;
  const actualAmount = overrides.actualAmount ?? projectedAmount;
  const scheduledDate = overrides.scheduledDate ?? "2026-01-15";
  return makeTransaction({
    status: "completed",
    projectedAmount,
    actualAmount,
    variance: actualAmount - projectedAmount,
    scheduledDate,
    actualDate: overrides.actualDate ?? scheduledDate,
    completedAt: TS,
    ...overrides,
  });
};

export const makeSkippedTransaction = (overrides: Partial<Transaction> = {}): Transaction =>
  makeTransaction({ status: "skipped", ...overrides });

export const makeManualTransaction = (overrides: Partial<Transaction> = {}): Transaction =>
  makeTransaction({ sourceType: "manual", sourceId: undefined, ...overrides });

export const makePaymentBreakdown = (
  overrides: Partial<PaymentBreakdown> = {}
): PaymentBreakdown => ({
  principalPaid: 400,
  interestPaid: 100,
  remainingBalance: 11_600,
  paymentNumber: 1,
  totalPayments: 24,
  ...overrides,
});

export const makeOverride = (overrides: Partial<OccurrenceOverride> = {}): OccurrenceOverride => ({
  ...overrides,
});

// ============================================================================
// ASSERTION HELPERS
// ============================================================================

/** Round to cents — floating point noise is not a behavioural difference. */
export const cents = (value: number): number => Math.round(value * 100) / 100;

/** Sum a numeric field across a list. */
export const sumBy = <T>(items: T[], pick: (item: T) => number): number =>
  cents(items.reduce((total, item) => total + pick(item), 0));
