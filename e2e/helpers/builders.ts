/**
 * Typed seed builders. Each returns a COMPLETE, valid document in the JSON wire
 * format of the fake Firestore (Timestamps as tagged objects), with boring
 * defaults so a spec only spells out the fields it cares about.
 *
 * Independence rule: nothing here imports app *logic*. The only app import is
 * `import type` from app/lib/types.ts so that shape drift breaks `tsc` instead
 * of silently seeding stale documents. Never compute expected values with app
 * code in a spec; derive them by hand from the seed.
 *
 * Defaults are anchored on FIXED_TODAY (2026-03-10) — see helpers/clock.ts.
 */
import type { Timestamp } from "firebase/firestore";
import type {
  Alert,
  BalanceSnapshot,
  CreditConfig,
  ExpenseRule,
  ExpenseType,
  InstallmentConfig,
  IncomeSource,
  LoanConfig,
  Transaction,
  UserProfile,
} from "../../app/lib/types";
import { TIMESTAMP_TAG, type TimestampJSON } from "../shared/protocol";

export type { TimestampJSON };

/** Replace every Firestore `Timestamp` field type with its JSON wire form. */
export type Seed<T> = {
  [K in keyof T]: T[K] extends Timestamp ? TimestampJSON : T[K] extends Timestamp | undefined ? TimestampJSON | undefined : T[K];
};

export type UserProfileSeed = Seed<UserProfile>;
export type IncomeSourceSeed = Seed<IncomeSource>;
export type ExpenseRuleSeed = Seed<ExpenseRule>;
export type TransactionSeed = Seed<Transaction>;
export type BalanceSnapshotSeed = Seed<BalanceSnapshot>;
export type AlertSeed = Seed<Alert>;

export const TEST_UID = "e2e-user-1";
export const TEST_EMAIL = "e2e.user@example.com";
export const TEST_NAME = "E2E User";

/** Anchor for default createdAt/startDate values. Same as clock.FIXED_TODAY. */
const ANCHOR = "2026-01-01T00:00:00.000Z";

/** ISO string / Date / epoch ms -> Timestamp wire form. */
export const ts = (input: string | number | Date = ANCHOR): TimestampJSON => {
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : new Date(input).getTime();
  if (Number.isNaN(ms)) throw new Error(`ts(): invalid date ${String(input)}`);
  const seconds = Math.floor(ms / 1000);
  return { __type: TIMESTAMP_TAG, seconds, nanoseconds: (ms - seconds * 1000) * 1e6 };
};

let idCounter = 0;
/** Unique, readable ids within a worker process. */
export const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export const userProfile = (o: Partial<UserProfileSeed> = {}): UserProfileSeed => ({
  uid: TEST_UID,
  email: TEST_EMAIL,
  displayName: TEST_NAME,
  currentBalance: 0,
  initialBalance: 0,
  balanceLastUpdatedAt: "2026-03-10",
  // seeded profiles are already on the current balance model (see tests/helpers/builders.ts)
  balanceModelVersion: 1,
  createdAt: ts(),
  updatedAt: ts(),
  ...o,
  preferences: {
    currency: "USD",
    dateFormat: "MM/DD/YYYY",
    startOfWeek: 0,
    theme: "dark",
    defaultWarningThreshold: 500,
    ...(o.preferences ?? {}),
  },
});

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export const incomeSource = (o: Partial<IncomeSourceSeed> = {}): IncomeSourceSeed => ({
  id: nextId("inc"),
  userId: TEST_UID,
  name: "Salary",
  sourceType: "salary",
  amount: 3000,
  isVariableAmount: false,
  frequency: "monthly",
  startDate: "2026-01-01",
  scheduleConfig: { dayOfMonth: 1 },
  weekendAdjustment: "none",
  category: "salary",
  isActive: true,
  createdAt: ts(),
  updatedAt: ts(),
  ...o,
});

// ---------------------------------------------------------------------------
// Expenses — one builder per expenseType, so type-specific config is complete.
// ---------------------------------------------------------------------------

export const expenseRule = (o: Partial<ExpenseRuleSeed> = {}): ExpenseRuleSeed => ({
  id: nextId("exp"),
  userId: TEST_UID,
  name: "Rent",
  expenseType: "fixed" satisfies ExpenseType,
  category: "housing",
  amount: 1200,
  isVariableAmount: false,
  frequency: "monthly",
  startDate: "2026-01-01",
  scheduleConfig: { dayOfMonth: 1 },
  weekendAdjustment: "none",
  isActive: true,
  isPriority: false,
  createdAt: ts(),
  updatedAt: ts(),
  ...o,
});

export const fixedExpense = (o: Partial<ExpenseRuleSeed> = {}): ExpenseRuleSeed =>
  expenseRule({ expenseType: "fixed", ...o });

export const variableExpense = (o: Partial<ExpenseRuleSeed> = {}): ExpenseRuleSeed =>
  expenseRule({
    name: "Groceries",
    expenseType: "variable",
    category: "groceries",
    amount: 400,
    isVariableAmount: true,
    frequency: "weekly",
    scheduleConfig: { dayOfWeek: 6 },
    ...o,
  });

export const oneTimeExpense = (o: Partial<ExpenseRuleSeed> = {}): ExpenseRuleSeed =>
  expenseRule({
    name: "Laptop Repair",
    expenseType: "one-time",
    category: "other",
    amount: 250,
    frequency: "one-time",
    startDate: "2026-03-20",
    scheduleConfig: {},
    ...o,
  });

export const loanConfig = (o: Partial<LoanConfig> = {}): LoanConfig => ({
  principalAmount: 12000,
  currentBalance: 12000,
  interestRate: 12,
  termMonths: 24,
  monthlyPayment: 565,
  calculationType: "amortized",
  loanStartDate: "2026-01-01",
  firstPaymentDate: "2026-01-15",
  paymentsMade: 0,
  ...o,
});

export const cashLoan = (o: Partial<ExpenseRuleSeed> = {}, loan: Partial<LoanConfig> = {}): ExpenseRuleSeed =>
  expenseRule({
    name: "Car Loan",
    expenseType: "cash_loan",
    category: "debt_payment",
    amount: 565,
    scheduleConfig: { dayOfMonth: 15 },
    startDate: "2026-01-15",
    loanConfig: loanConfig(loan),
    ...o,
  });

export const creditConfig = (o: Partial<CreditConfig> = {}): CreditConfig => ({
  creditLimit: 10000,
  currentBalance: 5000,
  apr: 24,
  minimumPaymentPercent: 2,
  minimumPaymentFloor: 25,
  minimumPaymentMethod: "percent_only",
  statementDate: 1,
  dueDate: 15,
  paymentStrategy: "minimum",
  ...o,
});

export const creditCard = (o: Partial<ExpenseRuleSeed> = {}, credit: Partial<CreditConfig> = {}): ExpenseRuleSeed =>
  expenseRule({
    name: "Visa",
    expenseType: "credit_card",
    category: "debt_payment",
    amount: 100,
    scheduleConfig: { dayOfMonth: 15 },
    creditConfig: creditConfig(credit),
    ...o,
  });

export const installmentConfig = (o: Partial<InstallmentConfig> = {}): InstallmentConfig => ({
  totalAmount: 1200,
  installmentCount: 6,
  installmentAmount: 200,
  installmentsPaid: 0,
  hasInterest: false,
  ...o,
});

export const installment = (
  o: Partial<ExpenseRuleSeed> = {},
  plan: Partial<InstallmentConfig> = {}
): ExpenseRuleSeed =>
  expenseRule({
    name: "Laptop BNPL",
    expenseType: "installment",
    category: "personal",
    amount: 200,
    scheduleConfig: { dayOfMonth: 20 },
    installmentConfig: installmentConfig(plan),
    ...o,
  });

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const transaction = (o: Partial<TransactionSeed> = {}): TransactionSeed => ({
  id: nextId("txn"),
  userId: TEST_UID,
  sourceType: "manual",
  name: "Transaction",
  type: "expense",
  category: "other",
  projectedAmount: 100,
  scheduledDate: "2026-03-10",
  status: "projected",
  createdAt: ts(),
  updatedAt: ts(),
  ...o,
});

/** Completed transaction; actualAmount defaults to projectedAmount. */
export const completedTransaction = (o: Partial<TransactionSeed> = {}): TransactionSeed => {
  const projected = o.projectedAmount ?? 100;
  const actual = o.actualAmount ?? projected;
  const date = o.scheduledDate ?? "2026-03-10";
  return transaction({
    status: "completed",
    projectedAmount: projected,
    actualAmount: actual,
    variance: actual - projected,
    actualDate: date,
    completedAt: ts(`${date}T12:00:00.000Z`),
    ...o,
  });
};

export const balanceSnapshot = (o: Partial<BalanceSnapshotSeed> = {}): BalanceSnapshotSeed => ({
  id: nextId("bal"),
  userId: TEST_UID,
  date: "2026-03-09",
  openingBalance: 0,
  closingBalance: 0,
  totalIncome: 0,
  totalExpenses: 0,
  projectedIncome: 0,
  projectedExpenses: 0,
  isReconciled: false,
  createdAt: ts(),
  ...o,
});

export const alert = (o: Partial<AlertSeed> = {}): AlertSeed => ({
  id: nextId("alert"),
  userId: TEST_UID,
  type: "low_balance",
  severity: "warning",
  title: "Low balance",
  message: "Your balance is low",
  isRead: false,
  isDismissed: false,
  createdAt: ts(),
  ...o,
});
