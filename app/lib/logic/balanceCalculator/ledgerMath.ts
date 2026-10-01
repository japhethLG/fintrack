/**
 * Ledger arithmetic: the pure rules that define the realized balance and the
 * debt progress a completed payment causes. No Firestore, no React.
 *
 * THE INVARIANT (one owner for the balance, see docs/audit/fixes/write-path.md)
 *
 *   currentBalance == initialBalance + SUM(signed(completed stored rows))
 *
 * where signed(row) = +amount for income, -amount for an expense and
 * amount = actualAmount ?? projectedAmount. Only STORED rows count: a projection
 * (including an overdue one) has no effect until it is completed (decision D5).
 *
 * Every writer of the balance computes the change as
 *
 *   contribution(row after) - contribution(row before)
 *
 * from the row's own before/after state, so the same arithmetic serves
 * complete, re-complete, skip, revert, delete, type flips and amount edits, and
 * nothing is ever "nudged" from a stale copy of the balance.
 */

import { ExpenseRule, Transaction } from "@/lib/types";
import { resolvePaidIds } from "../projectionEngine/debtSlots";

type RowLike = Pick<Transaction, "status" | "type" | "projectedAmount"> &
  Partial<Pick<Transaction, "actualAmount" | "paymentBreakdown" | "sourceType" | "occurrenceId">>;

/** Sub-cent noise from float addition is removed; real sub-cent amounts survive. */
export const cleanMoney = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * Money is stored in whole cents. An amortized payment is 1045.5223363...; nobody pays that, and
 * keeping the fraction makes the stored ledger depend on float noise. Every amount a gesture
 * WRITES (projected and actual) goes through this.
 */
export const roundCents = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/** What was (or will be) paid: the recorded actual, else the projected amount. */
export const paidAmount = (row: Pick<Transaction, "projectedAmount" | "actualAmount">): number =>
  row.actualAmount ?? row.projectedAmount;

/** Signed effect of one stored row on the realized balance (0 unless completed). */
export const ledgerContribution = (row: RowLike | null | undefined): number => {
  if (!row || row.status !== "completed") return 0;
  const amount = paidAmount(row);
  return row.type === "income" ? amount : -amount;
};

/** SUM(signed(completed)) over a list of STORED rows. */
export const sumLedger = (rows: readonly RowLike[]): number =>
  cleanMoney(rows.reduce((sum, row) => sum + ledgerContribution(row), 0));

// ============================================================================
// DEBT PROGRESS
// ============================================================================

/** What one completed payment has applied to its loan / card / installment plan. */
export interface DebtEffect {
  /** Payments counted toward the plan (`paymentsMade` / `installmentsPaid`). */
  payments: number;
  /**
   * Principal removed from the outstanding balance: the amount paid minus the
   * interest portion of that period (the interest is recorded on the row's
   * `paymentBreakdown`; without one the whole payment is principal). Negative
   * when a payment does not cover the interest: the shortfall capitalises.
   */
  principal: number;
  /** The occurrence (payment slot) the payment counts for, when the row names one. */
  occurrenceId?: string;
}

export const NO_DEBT_EFFECT: DebtEffect = { payments: 0, principal: 0 };

type DebtBearing = Pick<ExpenseRule, "loanConfig" | "creditConfig" | "installmentConfig"> &
  Partial<Pick<ExpenseRule, "id" | "frequency" | "startDate" | "scheduleConfig">>;

/**
 * The debt progress a stored row has applied. A pure function of the row and
 * the kind of rule, so applying a change is `effect(after) - effect(before)`
 * and reversing is exact by construction (complete -> revert -> complete, or
 * complete -> complete, cannot drift).
 *
 * Precedence follows the original write path: loan, then card, then installment.
 */
export const debtEffectOf = (rule: DebtBearing | null | undefined, row: RowLike | null | undefined): DebtEffect => {
  if (!rule || !row || row.sourceType !== "expense_rule" || row.status !== "completed") {
    return NO_DEBT_EFFECT;
  }
  const principal = cleanMoney(paidAmount(row) - (row.paymentBreakdown?.interestPaid ?? 0));
  const slot = row.occurrenceId ? { occurrenceId: row.occurrenceId } : {};
  if (rule.loanConfig) return { payments: 1, principal, ...slot };
  if (rule.creditConfig) return { payments: 1, principal, ...slot };
  if (rule.installmentConfig) return { payments: 1, principal: 0, ...slot };
  return NO_DEBT_EFFECT;
};

/** Below this an outstanding balance is treated as repaid (half a cent). */
const REPAID_EPSILON = 0.005;

/** `isActive` for a plan that is (was) finished: off once finished, back on when un-finished. */
const activeFlag = (
  isActive: boolean,
  wasFinished: boolean,
  isFinished: boolean
): { isActive: boolean } | Record<string, never> => {
  if (isFinished && isActive) return { isActive: false };
  if (!isFinished && wasFinished && !isActive) return { isActive: true };
  return {};
};

/**
 * The plan's paid-slot list after a payment moves from `before` to `after` (MANUAL-M9): the slot `before`
 * counted is released, the slot `after` counts is taken. Starts from the stored list, or from the
 * pre-list reading (first N slots) when there is none. `undefined` when the result cannot be trusted
 * (a row without an occurrence id, a slot the list does not hold, a rule without schedule fields): the
 * list is then dropped and readers fall back to the first-N reading, exactly as before the list existed.
 */
const nextPaidIds = (
  rule: DebtBearing,
  before: DebtEffect,
  after: DebtEffect,
  paymentsAfter: number
): string[] | undefined => {
  let ids: string[];
  try {
    ids = resolvePaidIds(rule as Parameters<typeof resolvePaidIds>[0]);
  } catch {
    return undefined;
  }
  if (before.payments > 0) {
    const at = before.occurrenceId === undefined ? -1 : ids.indexOf(before.occurrenceId);
    if (at < 0) return undefined;
    ids.splice(at, 1);
  }
  if (after.payments > 0) {
    if (after.occurrenceId === undefined || ids.includes(after.occurrenceId)) return undefined;
    ids.push(after.occurrenceId);
  }
  return ids.length === paymentsAfter ? ids : undefined;
};

/** `config` with its paid-slot list replaced by `ids` (or removed when `ids` is undefined). */
const withPaidIds = <C extends { paidOccurrenceIds?: string[] }>(config: C, ids: string[] | undefined): C => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { paidOccurrenceIds: _previous, ...rest } = config;
  return (ids ? { ...rest, paidOccurrenceIds: ids } : rest) as C;
};

/**
 * The fields to write on a rule so its debt progress moves from what `before`
 * had applied to what `after` applies. `null` when nothing changes.
 *
 * `isActive` follows the plan: a loan that is repaid / an installment plan that is
 * complete is deactivated, and undoing the payment that finished it reactivates it.
 * A rule the user deactivated by hand is left alone while it is not finished.
 */
export const planDebtUpdate = (
  rule: DebtBearing & Pick<ExpenseRule, "isActive">,
  before: DebtEffect,
  after: DebtEffect
): Partial<Pick<ExpenseRule, "loanConfig" | "creditConfig" | "installmentConfig" | "isActive">> | null => {
  const dPayments = after.payments - before.payments;
  const dPrincipal = cleanMoney(after.principal - before.principal);
  const sameSlot = (before.payments > 0 ? before.occurrenceId : undefined) === (after.payments > 0 ? after.occurrenceId : undefined);
  if (dPayments === 0 && dPrincipal === 0 && sameSlot) return null;

  if (rule.loanConfig) {
    const previous = rule.loanConfig;
    // Debt balances are stored in whole cents, like every amount the ledger writes (MANUAL-L2)
    const currentBalance = Math.max(0, roundCents(previous.currentBalance - dPrincipal));
    const paymentsMade = Math.max(0, previous.paymentsMade + dPayments);
    const wasRepaid = previous.currentBalance <= REPAID_EPSILON;
    const isRepaid = currentBalance <= REPAID_EPSILON;
    return {
      loanConfig: withPaidIds(
        { ...previous, currentBalance, paymentsMade },
        nextPaidIds(rule, before, after, paymentsMade)
      ),
      ...activeFlag(rule.isActive, wasRepaid, isRepaid),
    };
  }
  if (rule.creditConfig) {
    const previous = rule.creditConfig;
    const paymentsMade = Math.max(0, (previous.paymentsMade ?? 0) + dPayments);
    return {
      creditConfig: withPaidIds(
        {
          ...previous,
          currentBalance: Math.max(0, roundCents(previous.currentBalance - dPrincipal)),
          paymentsMade,
        },
        nextPaidIds(rule, before, after, paymentsMade)
      ),
    };
  }
  if (rule.installmentConfig) {
    const previous = rule.installmentConfig;
    const installmentsPaid = Math.max(0, previous.installmentsPaid + dPayments);
    const wasComplete = previous.installmentsPaid >= previous.installmentCount;
    const isComplete = installmentsPaid >= previous.installmentCount;
    return {
      installmentConfig: withPaidIds(
        { ...previous, installmentsPaid },
        nextPaidIds(rule, before, after, installmentsPaid)
      ),
      ...activeFlag(rule.isActive, wasComplete, isComplete),
    };
  }
  return null;
};
