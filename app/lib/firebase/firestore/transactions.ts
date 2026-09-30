/**
 * Transaction Operations
 * CRUD operations and real-time subscriptions for transactions
 * Includes batch operations and transaction completion logic
 */

import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  onSnapshot,
  writeBatch,
  limit,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "../config";
import { CompleteTransactionData, Transaction } from "@/lib/types";
import { removeUndefined } from "./utils";
import {
  OverrideChange,
  RowData,
  occurrenceRowId,
  runLedgerTransaction,
  transactionRef,
} from "./ledger";
import { patternDateOfOccurrence } from "./occurrenceDates";

export const addTransaction = async (
  userId: string,
  transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
): Promise<Transaction> => {
  const now = Timestamp.now();
  // Remove undefined values before writing to Firestore
  const cleanedData = removeUndefined({
    ...transaction,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(collection(db, "transactions"), cleanedData);
  return { id: docRef.id, userId, createdAt: now, updatedAt: now, ...transaction };
};

export const addTransactionsBatch = async (
  userId: string,
  transactions: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">[]
): Promise<void> => {
  const batch = writeBatch(db);
  const now = Timestamp.now();
  const transactionsRef = collection(db, "transactions");

  transactions.forEach((transaction) => {
    const docRef = doc(transactionsRef);
    // Remove undefined values before writing to Firestore
    const cleanedData = removeUndefined({
      ...transaction,
      userId,
      createdAt: now,
      updatedAt: now,
    });
    batch.set(docRef, cleanedData);
  });

  await batch.commit();
};

export const getTransactions = async (
  userId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    status?: Transaction["status"] | Transaction["status"][];
    type?: Transaction["type"];
    sourceId?: string;
    limit?: number;
  }
): Promise<Transaction[]> => {
  const transactionsRef = collection(db, "transactions");
  const constraints: QueryConstraint[] = [
    where("userId", "==", userId),
    orderBy("scheduledDate", "asc"),
  ];

  if (options?.startDate) {
    constraints.push(where("scheduledDate", ">=", options.startDate));
  }
  if (options?.endDate) {
    constraints.push(where("scheduledDate", "<=", options.endDate));
  }
  // status / type / sourceId are filtered on the client (they cannot be combined with
  // the orderBy), so a server-side limit would cut the list BEFORE those filters and
  // return fewer rows than asked for. Apply it after the filters instead.
  const hasClientFilter = !!(options?.status || options?.type || options?.sourceId);
  if (options?.limit && !hasClientFilter) {
    constraints.push(limit(options.limit));
  }

  const q = query(transactionsRef, ...constraints);
  const snapshot = await getDocs(q);
  let transactions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction);

  // Client-side filtering for fields that can't be combined with orderBy
  if (options?.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    transactions = transactions.filter((t) => statuses.includes(t.status));
  }
  if (options?.type) {
    transactions = transactions.filter((t) => t.type === options.type);
  }
  if (options?.sourceId) {
    transactions = transactions.filter((t) => t.sourceId === options.sourceId);
  }
  if (options?.limit && hasClientFilter) {
    transactions = transactions.slice(0, options.limit);
  }

  return transactions;
};

export const getTransaction = async (id: string): Promise<Transaction | null> => {
  const docRef = doc(db, "transactions", id);
  const snapshot = await getDoc(docRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() } as Transaction;
  }
  return null;
};

export const updateTransaction = async (
  id: string,
  updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt">>
): Promise<void> => {
  const docRef = doc(db, "transactions", id);

  // Check if document exists before updating
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Transaction with ID ${id} does not exist`);
  }

  // Remove undefined values before updating
  const cleanedUpdates = removeUndefined({
    ...updates,
    updatedAt: Timestamp.now(),
  });

  await updateDoc(docRef, cleanedUpdates);
};

// ============================================================================
// LEDGER GESTURES
//
// Every function below changes a stored row, the realized balance and (for a
// loan / card / installment payment) the plan's progress in ONE Firestore
// transaction: see ledger.ts. They never compute a balance delta from a value
// the caller read earlier.
// ============================================================================

/** Fields that only make sense while a row is completed. */
const COMPLETION_FIELDS: (keyof RowData)[] = [
  "actualAmount",
  "actualDate",
  "variance",
  "completedAt",
];

type StoredRow = Omit<Transaction, "id">;

/** A stored row as plain data (no id), ready to be edited into the next state. */
const rowData = (old: Transaction): StoredRow => {
  const { id: _id, ...data } = old;
  void _id;
  return data;
};

const assertValidActualAmount = (amount: number): void => {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Actual amount must be a number that is 0 or more");
  }
};

/** The completed version of a row: amount, date, variance and stamp set together. */
const completedRow = (
  old: StoredRow,
  actualAmount: number,
  actualDate: string | undefined,
  notes: string | undefined
): StoredRow => ({
  ...old,
  actualAmount,
  actualDate: actualDate || old.scheduledDate,
  variance: actualAmount - old.projectedAmount,
  status: "completed",
  completedAt: Timestamp.now(),
  // only `undefined` means "leave the note alone"; "" clears it
  notes: notes !== undefined ? notes : old.notes,
});

/** The row as it is after leaving the completed state (no stale actual amount/date/variance). */
const skippedRow = (old: StoredRow, notes: string | undefined): StoredRow => {
  const next: StoredRow = {
    ...old,
    status: "skipped",
    notes: notes !== undefined ? notes : old.notes,
  };
  COMPLETION_FIELDS.forEach((field) => delete (next as unknown as Record<string, unknown>)[field]);
  return next;
};

/** The acting user of a stored-row gesture: the caller's, else the row's own owner. */
const actingUser = async (id: string, userId: string | undefined): Promise<string> => {
  if (userId) return userId;
  const existing = await getTransaction(id);
  if (!existing) throw new Error("Transaction not found");
  return existing.userId;
};

/**
 * Complete (or re-complete) a STORED row. Re-completing replaces the row's
 * earlier contribution instead of adding to it, and advances a debt plan only on
 * the real projected/skipped -> completed transition.
 */
export const completeTransaction = async (
  id: string,
  actualAmount: number,
  actualDate?: string,
  notes?: string,
  userId?: string
): Promise<void> => {
  assertValidActualAmount(actualAmount);
  const uid = await actingUser(id, userId);
  await runLedgerTransaction({
    userId: uid,
    rowRef: transactionRef(id),
    plan: ({ old }) => {
      if (!old) throw new Error("Transaction not found");
      return { after: completedRow(rowData(old), actualAmount, actualDate, notes) };
    },
  });
};

/** Skip a STORED row; a previously completed row gives its contribution back. */
export const skipTransaction = async (id: string, notes?: string, userId?: string): Promise<void> => {
  const uid = await actingUser(id, userId);
  await runLedgerTransaction({
    userId: uid,
    rowRef: transactionRef(id),
    plan: ({ old }) => {
      if (!old) throw new Error("Transaction not found");
      return { after: skippedRow(rowData(old), notes), clear: COMPLETION_FIELDS };
    },
  });
};

/**
 * Revert a stored rule-based row back to projected status.
 * The stored row is deleted (it regenerates as a projection); its balance
 * contribution and debt progress are reversed exactly; and, if the user had moved
 * the row off the date the rule's pattern gives, that custom date is preserved as
 * an occurrence override. All in one commit.
 *
 * @returns what was deleted (for callers that report it)
 */
export const revertToProjected = async (
  id: string,
  userId?: string
): Promise<{
  scheduledDate: string;
  sourceId: string;
  sourceType: "income_source" | "expense_rule";
  occurrenceId?: string;
} | null> => {
  const uid = await actingUser(id, userId);
  const { before } = await runLedgerTransaction({
    userId: uid,
    rowRef: transactionRef(id),
    plan: ({ old, source }) => {
      if (!old) throw new Error("Transaction not found");
      // Cannot revert manual transactions - they have no source to project from
      if (old.sourceType === "manual") {
        throw new Error("Manual transactions cannot be reverted to projected");
      }
      // Must have a source to revert to
      if (!old.sourceId) throw new Error("Transaction has no source to revert to");

      let override: OverrideChange | undefined;
      if (old.occurrenceId && source) {
        const isIncome = old.sourceType === "income_source";
        const pattern = patternDateOfOccurrence(source, isIncome, old.occurrenceId, old.scheduledDate);
        const existing = source.occurrenceOverrides?.[old.occurrenceId]?.scheduledDate;
        if (pattern !== old.scheduledDate) {
          // the user moved it: keep that date (other override fields survive)
          override = { occurrenceId: old.occurrenceId, patch: { scheduledDate: old.scheduledDate } };
        } else if (existing !== undefined && existing !== old.scheduledDate) {
          // a stale override would move the regenerated projection away from the row's date
          override = { occurrenceId: old.occurrenceId, unset: ["scheduledDate"] };
        }
      }
      return { after: null, override };
    },
  });
  if (!before) return null;
  return {
    scheduledDate: before.scheduledDate,
    sourceId: before.sourceId as string,
    sourceType: before.sourceType as "income_source" | "expense_rule",
    occurrenceId: before.occurrenceId,
  };
};

/**
 * The stored row a rule occurrence becomes the first time it is acted on.
 * Built by the action layer from the projection the user was looking at.
 */
export type OccurrenceBase = Omit<
  Transaction,
  "id" | "userId" | "createdAt" | "updatedAt" | "status" | "actualAmount" | "actualDate" | "variance"
> & { occurrenceId: string; sourceId: string; sourceType: "income_source" | "expense_rule" };

/** Existing row as the start state, or a fresh projected row for a first-time gesture. */
const startRow = (old: Transaction | null, base: OccurrenceBase, userId: string): StoredRow =>
  old ? rowData(old) : ({ ...base, userId, status: "projected" } as StoredRow);

/**
 * Complete a PROJECTION: materialise its stored row as completed, in one commit
 * with the balance change, the debt progress and the override cleanup.
 *
 * The row has a deterministic id per (user, occurrence), so this is
 * "create if absent, otherwise update": doing it twice (a retry after a failed
 * attempt, a double click, a stale second tab) never stores a second row and
 * never counts the money twice.
 */
export const completeOccurrence = async (
  userId: string,
  base: OccurrenceBase,
  data: CompleteTransactionData,
  options: { removeOverride?: boolean } = {}
): Promise<void> => {
  assertValidActualAmount(data.actualAmount);
  await runLedgerTransaction({
    userId,
    rowRef: transactionRef(occurrenceRowId(userId, base.occurrenceId)),
    sourceHint: { sourceType: base.sourceType, sourceId: base.sourceId },
    plan: ({ old }) => ({
      after: completedRow(startRow(old, base, userId), data.actualAmount, data.actualDate, data.notes),
      override: options.removeOverride
        ? { occurrenceId: base.occurrenceId, remove: true }
        : undefined,
    }),
  });
};

/** Skip a PROJECTION: same create-if-absent semantics as `completeOccurrence`. */
export const skipOccurrence = async (
  userId: string,
  base: OccurrenceBase,
  notes: string | undefined,
  options: { removeOverride?: boolean } = {}
): Promise<void> => {
  await runLedgerTransaction({
    userId,
    rowRef: transactionRef(occurrenceRowId(userId, base.occurrenceId)),
    sourceHint: { sourceType: base.sourceType, sourceId: base.sourceId },
    plan: ({ old }) => ({
      after: skippedRow(startRow(old, base, userId), notes),
      clear: COMPLETION_FIELDS,
      override: options.removeOverride
        ? { occurrenceId: base.occurrenceId, remove: true }
        : undefined,
    }),
  });
};

/**
 * Create a manual transaction. A row created as completed moves the balance in
 * the same commit (it used to be stored without touching it: UI-BAL-01, UI-LIFE-03).
 */
export const addTransactionWithBalance = async (
  userId: string,
  transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
): Promise<Transaction> => {
  const now = Timestamp.now();
  const rowRef = doc(collection(db, "transactions"));
  await runLedgerTransaction({
    userId,
    rowRef,
    plan: () => ({
      after: {
        ...transaction,
        userId,
        createdAt: now,
        updatedAt: now,
        // a row created as completed is stamped like any other completion
        ...(transaction.status === "completed" ? { completedAt: now } : {}),
      } as RowData,
    }),
  });
  return { id: rowRef.id, userId, createdAt: now, updatedAt: now, ...transaction };
};

/**
 * Edit a MANUAL transaction. The balance change is the difference between what
 * the row contributed before and what it contributes after, so a type flip, an
 * amount edit, a status change or a no-op edit are all the same arithmetic.
 *
 * Only fields that are not `undefined` are applied (`undefined` leaves a field
 * alone; an empty string clears a note). Leaving the completed state drops the
 * row's actual amount, actual date and variance.
 */
export const updateManualTransactionWithBalance = async (
  id: string,
  updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">>,
  userId: string
): Promise<void> => {
  await runLedgerTransaction({
    userId,
    rowRef: transactionRef(id),
    plan: ({ old }) => {
      if (!old) throw new Error("Transaction not found");
      if (old.sourceType !== "manual") {
        throw new Error("This action is only for manual transactions");
      }
      const defined = removeUndefined(updates as Record<string, unknown>) as Partial<StoredRow>;
      const merged: StoredRow = { ...rowData(old), ...defined };
      if (old.status === "completed" && merged.status !== "completed") {
        // leaving the completed state: no stale actual amount, date or variance survives
        COMPLETION_FIELDS.forEach(
          (field) => delete (merged as unknown as Record<string, unknown>)[field]
        );
        return { after: merged, clear: COMPLETION_FIELDS };
      }
      if (merged.status === "completed") {
        if (old.status !== "completed") merged.completedAt = Timestamp.now();
        // variance always follows the amounts the row now carries
        if (merged.actualAmount !== undefined) {
          merged.variance = merged.actualAmount - merged.projectedAmount;
        }
      }
      return { after: merged };
    },
  });
};

/** Delete a stored row; a completed one takes its contribution (and debt progress) with it. */
export const deleteTransactionWithBalance = async (id: string, userId: string): Promise<void> => {
  await runLedgerTransaction({
    userId,
    rowRef: transactionRef(id),
    plan: ({ old }) => {
      if (!old) throw new Error("Transaction not found");
      return { after: null };
    },
  });
};

export const deleteTransaction = async (id: string): Promise<void> => {
  const docRef = doc(db, "transactions", id);
  await deleteDoc(docRef);
};

export const deleteTransactionsBySource = async (
  sourceType: Transaction["sourceType"],
  sourceId: string,
  statusFilter?: Transaction["status"][]
): Promise<void> => {
  const transactionsRef = collection(db, "transactions");
  const q = query(
    transactionsRef,
    where("sourceType", "==", sourceType),
    where("sourceId", "==", sourceId)
  );

  const snapshot = await getDocs(q);
  const refs = snapshot.docs
    .filter((docSnapshot) => {
      const transaction = docSnapshot.data() as Transaction;
      return !statusFilter || statusFilter.includes(transaction.status);
    })
    .map((docSnapshot) => docSnapshot.ref);

  // batches are atomic but capped at 500 operations
  for (let i = 0; i < refs.length || i === 0; i += 500) {
    const batch = writeBatch(db);
    refs.slice(i, i + 500).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

// Real-time listener for transactions (legacy - with date filtering)
export const subscribeToTransactions = (
  userId: string,
  callback: (transactions: Transaction[]) => void,
  options?: {
    startDate?: string;
    endDate?: string;
  }
): (() => void) => {
  const transactionsRef = collection(db, "transactions");
  const constraints: QueryConstraint[] = [
    where("userId", "==", userId),
    orderBy("scheduledDate", "asc"),
  ];

  if (options?.startDate) {
    constraints.push(where("scheduledDate", ">=", options.startDate));
  }
  if (options?.endDate) {
    constraints.push(where("scheduledDate", "<=", options.endDate));
  }

  const q = query(transactionsRef, ...constraints);
  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction);
    callback(transactions);
  });
};

/**
 * Subscribe to stored transactions only (excludes projected status from rules).
 * Used with on-the-fly projection computation - fetches completed, skipped, AND manual projected transactions.
 * Manual transactions with projected status need to be fetched since they're stored, not generated.
 * No date filtering - fetches all stored transactions for the user.
 */
export const subscribeToStoredTransactions = (
  userId: string,
  callback: (transactions: Transaction[]) => void
): (() => void) => {
  const transactionsRef = collection(db, "transactions");

  // Fetch all stored transactions
  // Rule-based: only completed/skipped (projected are generated on-the-fly)
  // Manual: all statuses (projected, completed, skipped) since they're all stored
  const q = query(transactionsRef, where("userId", "==", userId), orderBy("scheduledDate", "asc"));

  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction);

    // Filter to only include:
    // 1. Manual transactions (all statuses)
    // 2. Rule-based transactions that are completed or skipped
    const filteredTransactions = transactions.filter(
      (t) => t.sourceType === "manual" || t.status === "completed" || t.status === "skipped"
    );

    callback(filteredTransactions);
  });
};
