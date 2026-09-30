/**
 * The ledger: the ONE place where a stored transaction, the user's realized
 * balance and a loan / card / installment plan change together.
 *
 * WHY THIS EXISTS (R3 + R6, docs/audit/fixes/write-path.md)
 *
 * Every gesture used to be 2-4 separate writes (row, balance, rule counters,
 * override) issued one after another from several call sites, each deriving the
 * balance change from a stale copy. A failure half-way left money half-applied
 * (E2E-ROB-01/03), a retry stored a second completed row (ROB-02), two gestures
 * in flight lost one balance delta (UI-BAL-42), and a stale second tab counted
 * one occurrence twice (ROB-11).
 *
 * Now every such gesture runs as ONE Firestore transaction:
 *
 *   1. read the row, its source (rule / income source) and - only if the balance
 *      moves - the profile, inside the transaction;
 *   2. plan the new row state with a pure function of the row as it is NOW;
 *   3. write the row, the source (debt counters, occurrence override) and the
 *      profile (`currentBalance`) in one atomic commit.
 *
 * The balance change is `contribution(after) - contribution(before)`, both read
 * inside the transaction, so:
 *   - it is atomic (all writes land or none do);
 *   - concurrent gestures serialise: Firestore re-runs a transaction whose read
 *     documents changed, so a delta is never computed from a stale balance;
 *   - re-applying an already-applied gesture has delta 0 (idempotent), and a
 *     completion of a never-moved occurrence uses a deterministic document id,
 *     so two tabs completing the same occurrence address the SAME document.
 *
 * `currentBalance` therefore stays a cache of `initialBalance + SUM(signed(
 * completed))` that only this module (and the explicit recompute tools in
 * `balance.ts`) write. Nothing outside computes a delta from UI state.
 */

import { doc, deleteField, runTransaction, Timestamp } from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { db } from "../config";
import { ExpenseRule, IncomeSource, Transaction } from "@/lib/types";
import {
  cleanMoney,
  debtEffectOf,
  ledgerContribution,
  planDebtUpdate,
} from "@/lib/logic/balanceCalculator/ledgerMath";
import { getTodayKey } from "@/lib/utils/dateUtils";
import { removeUndefined } from "./utils";

/** A stored row without its id (timestamps and owner are filled in on create). */
export type RowData = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt"> &
  Partial<Pick<Transaction, "userId" | "createdAt" | "updatedAt">>;

type SourceType = "income_source" | "expense_rule";
type SourceDoc = (IncomeSource | ExpenseRule) & { id: string };

/** Raised when an action tries to touch a document that belongs to another user. */
export class LedgerOwnershipError extends Error {
  constructor(message = "This transaction belongs to a different account.") {
    super(message);
    this.name = "LedgerOwnershipError";
  }
}

// ============================================================================
// REFERENCES
// ============================================================================

export const transactionRef = (id: string): DocumentReference => doc(db, "transactions", id);
export const userDocRef = (uid: string): DocumentReference => doc(db, "users", uid);
const sourceRef = (sourceType: SourceType, sourceId: string): DocumentReference =>
  doc(db, sourceType === "income_source" ? "income_sources" : "expense_rules", sourceId);

/**
 * Deterministic document id of the stored row for one occurrence of a rule.
 * Completing or skipping a projection addresses this id, so the gesture is
 * "create if absent, otherwise update": a retry, a double click or a stale second
 * tab lands on the same document instead of creating a duplicate.
 */
export const occurrenceRowId = (userId: string, occurrenceId: string): string =>
  `${userId}__${occurrenceId}`.replace(/\//g, "_");

// ============================================================================
// PLANS
// ============================================================================

/** An occurrence-override change to make on the row's source, in the same commit. */
export type OverrideChange =
  | { occurrenceId: string; remove: true }
  /** Replace the whole override of one occurrence. */
  | { occurrenceId: string; set: Record<string, unknown> }
  /** Change single fields of the override; its other fields (amount, notes) survive. */
  | { occurrenceId: string; patch?: Record<string, unknown>; unset?: string[] };

export interface RowPlan {
  /** The row after the gesture, or null to delete it. */
  after: RowData | null;
  /** Fields of an existing row to remove (written as deleteField). */
  clear?: (keyof RowData)[];
  override?: OverrideChange;
}

export interface LedgerContext {
  old: Transaction | null;
  source: SourceDoc | null;
}

export interface LedgerRequest {
  /** The acting user. A row owned by anyone else is refused. */
  userId: string;
  rowRef: DocumentReference;
  /** Needed to create a row for a source that has no stored row yet. */
  sourceHint?: { sourceType: SourceType; sourceId: string };
  plan: (context: LedgerContext) => RowPlan;
}

export interface LedgerResult {
  before: Transaction | null;
  after: Transaction | null;
  /** Change applied to the realized balance (0 when none). */
  delta: number;
}

const nowStamp = () => Timestamp.now();

/** Apply a plan's changes to a row. `clear` fields are dropped from the result. */
const materialise = (plan: RowPlan, id: string): Transaction | null => {
  if (plan.after === null) return null;
  const next = { id, ...plan.after } as Transaction;
  (plan.clear ?? []).forEach((field) => {
    delete (next as unknown as Record<string, unknown>)[field as string];
  });
  return next;
};

/**
 * Run one gesture atomically. See the module comment for the guarantees.
 *
 * `plan` must be pure (it may be called again when Firestore retries the
 * transaction) and throws to abort before anything is written.
 */
export const runLedgerTransaction = async (request: LedgerRequest): Promise<LedgerResult> => {
  const { userId, rowRef, sourceHint, plan } = request;

  return runTransaction(db, async (tx) => {
    // ---- reads (all before any write) ---------------------------------------
    const rowSnap = await tx.get(rowRef);
    const old: Transaction | null = rowSnap.exists()
      ? ({ id: rowSnap.id, ...rowSnap.data() } as Transaction)
      : null;
    if (old && old.userId && old.userId !== userId) throw new LedgerOwnershipError();

    const coords =
      old && old.sourceType !== "manual" && old.sourceId
        ? { sourceType: old.sourceType as SourceType, sourceId: old.sourceId }
        : (sourceHint ?? null);
    let source: SourceDoc | null = null;
    let sourceDocRef: DocumentReference | null = null;
    if (coords) {
      sourceDocRef = sourceRef(coords.sourceType, coords.sourceId);
      const sourceSnap = await tx.get(sourceDocRef);
      if (sourceSnap.exists()) {
        const data = sourceSnap.data() as IncomeSource | ExpenseRule;
        // a source owned by someone else is never touched
        if (data.userId && data.userId !== userId) throw new LedgerOwnershipError();
        source = { ...data, id: sourceSnap.id } as SourceDoc;
      }
    }

    const rowPlan = plan({ old, source });
    const after = materialise(rowPlan, rowRef.id);
    const delta = cleanMoney(ledgerContribution(after) - ledgerContribution(old));

    const profileRef = userDocRef(userId);
    let currentBalance = 0;
    if (delta !== 0) {
      const profileSnap = await tx.get(profileRef);
      if (!profileSnap.exists()) throw new Error("User profile not found");
      currentBalance = (profileSnap.data() as { currentBalance?: number }).currentBalance ?? 0;
    }

    // ---- writes --------------------------------------------------------------
    // the row
    if (after === null) {
      if (old) tx.delete(rowRef);
    } else if (old === null) {
      const { id: _id, ...data } = after;
      void _id;
      tx.set(
        rowRef,
        removeUndefined({
          ...data,
          userId,
          createdAt: data.createdAt ?? nowStamp(),
          updatedAt: nowStamp(),
        })
      );
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fields: Record<string, any> = {};
      const { id: _id, ...data } = after;
      void _id;
      Object.entries(removeUndefined(data as unknown as Record<string, unknown>)).forEach(
        ([key, value]) => {
          if (key === "createdAt") return;
          if (JSON.stringify(value) !== JSON.stringify((old as unknown as Record<string, unknown>)[key])) {
            fields[key] = value;
          }
        }
      );
      (rowPlan.clear ?? []).forEach((field) => {
        if (field in (old as unknown as Record<string, unknown>)) fields[field as string] = deleteField();
      });
      fields.updatedAt = nowStamp();
      tx.update(rowRef, { ...fields });
    }

    // the source: debt progress and the occurrence override
    if (sourceDocRef && source) {
      const sourceFields: Record<string, unknown> = {};
      if (coords?.sourceType === "expense_rule") {
        const rule = source as ExpenseRule;
        const debt = planDebtUpdate(rule, debtEffectOf(rule, old), debtEffectOf(rule, after));
        if (debt) Object.assign(sourceFields, debt);
      }
      if (rowPlan.override) {
        const change = rowPlan.override;
        const key = `occurrenceOverrides.${change.occurrenceId}`;
        if ("remove" in change) {
          sourceFields[key] = deleteField();
        } else if ("set" in change) {
          sourceFields[key] = removeUndefined({ ...change.set });
        } else {
          Object.entries(removeUndefined({ ...(change.patch ?? {}) })).forEach(([field, value]) => {
            sourceFields[`${key}.${field}`] = value;
          });
          (change.unset ?? []).forEach((field) => {
            sourceFields[`${key}.${field}`] = deleteField();
          });
        }
      }
      if (Object.keys(sourceFields).length > 0) {
        tx.update(sourceDocRef, { ...sourceFields, updatedAt: nowStamp() });
      }
    }

    // the balance cache, written as the new absolute value computed from the
    // profile read in THIS transaction
    if (delta !== 0) {
      tx.update(profileRef, {
        currentBalance: cleanMoney(currentBalance + delta),
        balanceLastUpdatedAt: getTodayKey(),
        updatedAt: nowStamp(),
      });
    }

    return { before: old, after, delta };
  });
};
