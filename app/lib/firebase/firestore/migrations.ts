/**
 * Migration Utilities
 * One-time migration and data cleanup utilities
 */

import {
  collection,
  doc,
  query,
  where,
  getDocs,
  runTransaction,
  writeBatch,
  Timestamp,
  deleteField,
} from "firebase/firestore";
import type { DocumentReference } from "firebase/firestore";
import { db } from "../config";
import { DeletableDataType, ExpenseRule, Transaction } from "@/lib/types";
import { BALANCE_MODEL_VERSION, DEBT_SKIP_MODEL_VERSION, SCHEDULE_MODEL_VERSION, getUserProfile } from "./users";
import { isDebtRule } from "@/lib/utils/debtRules";
import { getCompletedTransactions } from "./balance";
import {
  getIncomeSource,
  getExpenseRule,
  setIncomeSourceOverride,
  setExpenseRuleOverride,
} from "./index";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import { cleanMoney, sumLedger } from "@/lib/logic/balanceCalculator/ledgerMath";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";

const MAX_BATCH_OPERATIONS = 500;

/** Delete documents in batches of at most 500 operations (the Firestore limit). */
const deleteInBatches = async (refs: DocumentReference[]): Promise<void> => {
  for (let i = 0; i < refs.length; i += MAX_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    refs.slice(i, i + MAX_BATCH_OPERATIONS).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

/**
 * Delete all projected transactions for a user.
 * This is a one-time migration utility to clean up when switching to on-the-fly projections.
 * Only deletes transactions with status "projected" - completed and skipped are preserved.
 */
export const deleteProjectedTransactions = async (userId: string): Promise<number> => {
  const transactionsRef = collection(db, "transactions");
  const q = query(
    transactionsRef,
    where("userId", "==", userId),
    where("status", "==", "projected")
  );

  const snapshot = await getDocs(q);
  const docs = snapshot.docs;

  if (docs.length === 0) {
    return 0;
  }

  await deleteInBatches(docs.map((docSnapshot) => docSnapshot.ref));
  return docs.length;
};

// ============================================================================
// RESETS
// ============================================================================

/** What a reset reports when it stopped after deleting only part of the data. */
export class ResetIncompleteError extends Error {
  readonly deleted: number;
  readonly total: number;
  constructor(deleted: number, total: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `The reset stopped part-way: ${deleted} of ${total} items were deleted, ${
        total - deleted
      } remain, and your balance was not changed. Run the reset again to finish. (${reason})`
    );
    this.name = "ResetIncompleteError";
    this.deleted = deleted;
    this.total = total;
  }
}

/**
 * Children before parents, so that if a reset ever stops part-way what remains is
 * still self-consistent (rules and sources without their history, never history
 * whose source vanished first) and running the reset again finishes the job.
 */
const DELETE_ORDER: DeletableDataType[] = [
  "transactions",
  "balance_history",
  "alerts",
  "expense_rules",
  "income_sources",
];

/**
 * Delete the chosen collections of ONE user, and (when `resetBalance`) reset the
 * balance model with them: balance 0 and baseline 0, so the invariant
 * `currentBalance == initialBalance + SUM(completed)` holds with nothing left.
 *
 * ATOMICITY (E2E-ROB-05). Every document is found first (a failing read changes
 * nothing). The deletes then go out in batches of at most 500 operations, each
 * atomic. The balance reset rides in the LAST batch, so it can never happen
 * without the deletes before it. For the usual account (a few hundred documents)
 * that is ONE batch: all or nothing. If a later batch fails after an earlier one
 * committed, the error says exactly how many items were deleted and that the
 * balance is untouched; the reset is idempotent, so running it again finishes it.
 */
const deleteUserData = async (
  userId: string,
  types: DeletableDataType[],
  options: { resetBalance: boolean; deleteProfile?: boolean }
): Promise<void> => {
  const refs: DocumentReference[] = [];
  for (const type of DELETE_ORDER.filter((candidate) => types.includes(candidate))) {
    const snapshot = await getDocs(query(collection(db, type), where("userId", "==", userId)));
    snapshot.docs.forEach((docSnapshot) => refs.push(docSnapshot.ref));
  }

  const chunks: DocumentReference[][] = [];
  for (let i = 0; i < refs.length; i += MAX_BATCH_OPERATIONS) {
    chunks.push(refs.slice(i, i + MAX_BATCH_OPERATIONS));
  }
  if (chunks.length === 0) chunks.push([]);
  // the balance reset / profile delete needs a slot in the last batch
  const lastBatchWrite = options.resetBalance || options.deleteProfile;
  if (lastBatchWrite && chunks[chunks.length - 1].length >= MAX_BATCH_OPERATIONS) {
    chunks.push([]);
  }

  let deleted = 0;
  for (let index = 0; index < chunks.length; index++) {
    const isLast = index === chunks.length - 1;
    const withReset = !!options.resetBalance && isLast;
    const withProfileDelete = !!options.deleteProfile && isLast;
    if (chunks[index].length === 0 && !withReset && !withProfileDelete) continue;
    const batch = writeBatch(db);
    chunks[index].forEach((ref) => batch.delete(ref));
    if (withProfileDelete) {
      batch.delete(doc(db, "users", userId));
    } else if (withReset) {
      batch.update(doc(db, "users", userId), {
        currentBalance: 0,
        initialBalance: 0,
        balanceModelVersion: BALANCE_MODEL_VERSION,
        balanceLastUpdatedAt: getTodayKey(),
        updatedAt: Timestamp.now(),
      });
    }
    try {
      await batch.commit();
    } catch (error) {
      if (deleted === 0) throw error; // nothing changed: report the real cause
      throw new ResetIncompleteError(deleted, refs.length, error);
    }
    deleted += chunks[index].length;
  }
};

/**
 * Delete all financial data for a user (income sources, expense rules, transactions, balance history, alerts)
 * This resets the user's financial data but keeps their profile; balance and baseline go to 0.
 */
export const deleteAllUserData = async (userId: string): Promise<void> => {
  await deleteUserData(userId, DELETE_ORDER, { resetBalance: true });
};

/**
 * Delete everything of a user, profile document included (account deletion). The profile
 * goes in the same final batch as the last documents, so a usual account is removed
 * all-or-nothing.
 */
export const deleteAccountData = async (userId: string): Promise<void> => {
  await deleteUserData(userId, DELETE_ORDER, { resetBalance: false, deleteProfile: true });
};

/**
 * Delete selected financial data collections for a user.
 * Deleting TRANSACTIONS resets balance and baseline to 0 (the history the balance
 * was built from is gone). Deleting anything else, balance history included,
 * leaves the balance alone: snapshots are not part of the balance (UI-BAL-15).
 */
export const deleteSelectiveUserData = async (
  userId: string,
  dataTypes: DeletableDataType[]
): Promise<void> => {
  if (dataTypes.length === 0) return;
  const uniqueTypes = Array.from(new Set<DeletableDataType>(dataTypes));
  await deleteUserData(userId, uniqueTypes, { resetBalance: uniqueTypes.includes("transactions") });
};

// ============================================================================
// LEGACY DATA
// ============================================================================

/**
 * Migrate legacy pending transactions into occurrence overrides.
 * For each pending transaction:
 * - Create an override on the associated source/rule with the scheduledDate/amount/notes
 * - Delete the pending transaction
 */
export const migratePendingToOverrides = async (userId: string): Promise<number> => {
  const transactionsRef = collection(db, "transactions");
  const pendingQuery = query(
    transactionsRef,
    where("userId", "==", userId),
    where("status", "==", "pending")
  );

  const snapshot = await getDocs(pendingQuery);
  if (snapshot.empty) return 0;

  let migrated = 0;
  const toDelete: DocumentReference[] = [];

  for (const docSnap of snapshot.docs) {
    const txn = docSnap.data() as Transaction;
    if (!txn.sourceId || !txn.sourceType) {
      toDelete.push(docSnap.ref);
      migrated++;
      continue;
    }

    const isIncome = txn.sourceType === "income_source";
    const source = isIncome
      ? await getIncomeSource(txn.sourceId)
      : await getExpenseRule(txn.sourceId);

    if (!source) {
      toDelete.push(docSnap.ref);
      migrated++;
      continue;
    }

    const occurrenceId =
      txn.occurrenceId ||
      generateOccurrenceId(
        source.id,
        source.frequency,
        parseDate(txn.scheduledDate),
        source.startDate,
        source.scheduleConfig
      );

    const override = {
      scheduledDate: txn.scheduledDate,
      amount: txn.projectedAmount,
      notes: txn.notes,
    };

    if (isIncome) {
      await setIncomeSourceOverride(source.id, occurrenceId, override);
    } else {
      await setExpenseRuleOverride(source.id, occurrenceId, override);
    }

    toDelete.push(docSnap.ref);
    migrated++;
  }

  // every override is written before any pending row is deleted
  await deleteInBatches(toDelete);
  return migrated;
};

/**
 * One-time, idempotent, versioned REBASE of a profile onto the current balance
 * model (decision D1: keep the balance the user sees, fix the baseline).
 *
 * The old migration seeded `initialBalance = currentBalance` although
 * `currentBalance` already contained every completed transaction, so
 * `initialBalance + SUM(completed)` double counted the history (N-1B: Recalculate
 * then wrote a balance too high). A profile without `balanceModelVersion`, or
 * without a numeric `initialBalance`, is rebased once:
 *
 *   initialBalance = currentBalance - SUM(signed(completed stored rows))
 *
 * `currentBalance` is never touched. The discrepancy the old model had is logged
 * with console.info. A profile already on the model (or one another tab rebased
 * first) is left alone: no write at all.
 */
export const migrateToInitialBalance = async (userId: string): Promise<void> => {
  const profile = await getUserProfile(userId);
  if (!profile) return;

  const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const isCurrent = (p: { initialBalance?: unknown; balanceModelVersion?: number }) =>
    isNumber(p.initialBalance) && (p.balanceModelVersion ?? 0) >= BALANCE_MODEL_VERSION;
  if (isCurrent(profile)) return;

  const ledgerSum = sumLedger(await getCompletedTransactions(userId));
  const userRef = doc(db, "users", userId);

  const outcome = await runTransaction(db, async (tx) => {
    const fresh = await tx.get(userRef);
    if (!fresh.exists()) return null;
    const stored = fresh.data() as typeof profile;
    if (isCurrent(stored)) return null; // another tab rebased first

    const hasBalance = isNumber(stored.currentBalance);
    const currentBalance = hasBalance ? stored.currentBalance : 0;
    const initialBalance = cleanMoney(currentBalance - ledgerSum);
    tx.update(userRef, {
      initialBalance,
      balanceModelVersion: BALANCE_MODEL_VERSION,
      // a profile that never had a balance starts from nothing
      ...(hasBalance ? {} : { currentBalance: 0 }),
      updatedAt: Timestamp.now(),
    });
    return {
      previousInitial: isNumber(stored.initialBalance) ? stored.initialBalance : null,
      initialBalance,
      currentBalance,
    };
  });

  if (outcome) {
    const oldImplied =
      outcome.previousInitial === null ? null : cleanMoney(outcome.previousInitial + ledgerSum);
    console.info(
      `[balance] rebased initialBalance for ${userId}: ${outcome.previousInitial ?? "none"} -> ${
        outcome.initialBalance
      } (currentBalance ${outcome.currentBalance} kept; completed history ${ledgerSum}` +
        (oldImplied === null
          ? ")"
          : `; the old model implied ${oldImplied}, off by ${cleanMoney(oldImplied - outcome.currentBalance)})`)
    );
  }
};

/**
 * One-time, idempotent, versioned step: pin the day of month of legacy loan and installment
 * rules to their start date's day.
 *
 * The old expense form saved the DAY OF CREATION as a hidden `scheduleConfig.dayOfMonth`, which
 * the old engine ignored for loans and installments (payments fell on the start date's day).
 * The engine now honours `dayOfMonth`, so a legacy rule started on the 10th with a stored 15
 * would suddenly pay on the 15th: a day the user never chose. For every `cash_loan` and
 * `installment` rule the day is set to the start date's day (parsed with the local `parseDate`),
 * so payments keep falling where they always did.
 *
 * `scheduleModelVersion` on the profile makes it run once; it is essential: a rerun would
 * overwrite a day the user chose later. The rule updates and the stamp go out together (one
 * atomic batch for up to 499 rules). Every change is logged with console.info.
 *
 * @returns the number of rules changed
 */
export const migrateLoanInstallmentDayOfMonth = async (userId: string): Promise<number> => {
  const profile = await getUserProfile(userId);
  if (!profile) return 0;
  if ((profile.scheduleModelVersion ?? 0) >= SCHEDULE_MODEL_VERSION) return 0;

  const snapshot = await getDocs(
    query(collection(db, "expense_rules"), where("userId", "==", userId))
  );
  const changes: { ref: DocumentReference; id: string; day: number; from: unknown; hasConfig: boolean }[] = [];
  snapshot.docs.forEach((docSnapshot) => {
    const rule = docSnapshot.data() as ExpenseRule;
    if (rule.expenseType !== "cash_loan" && rule.expenseType !== "installment") return;
    if (typeof rule.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate)) return;
    const day = parseDate(rule.startDate).getDate();
    if (rule.scheduleConfig?.dayOfMonth === day) return;
    changes.push({
      ref: docSnapshot.ref,
      id: docSnapshot.id,
      day,
      from: rule.scheduleConfig?.dayOfMonth,
      hasConfig: !!rule.scheduleConfig,
    });
  });

  const userRef = doc(db, "users", userId);
  const stamp = { scheduleModelVersion: SCHEDULE_MODEL_VERSION, updatedAt: Timestamp.now() };
  const apply = (batch: ReturnType<typeof writeBatch>, change: (typeof changes)[number]) => {
    const fields = change.hasConfig
      ? { "scheduleConfig.dayOfMonth": change.day, updatedAt: Timestamp.now() }
      : { scheduleConfig: { dayOfMonth: change.day }, updatedAt: Timestamp.now() };
    batch.update(change.ref, fields);
  };

  // the stamp rides in the LAST batch, so a stopped run is simply re-run
  for (let i = 0; i < changes.length; i += MAX_BATCH_OPERATIONS - 1) {
    const chunk = changes.slice(i, i + MAX_BATCH_OPERATIONS - 1);
    const isLast = i + MAX_BATCH_OPERATIONS - 1 >= changes.length;
    const batch = writeBatch(db);
    chunk.forEach((change) => apply(batch, change));
    if (isLast) batch.update(userRef, stamp);
    await batch.commit();
  }
  if (changes.length === 0) {
    const batch = writeBatch(db);
    batch.update(userRef, stamp);
    await batch.commit();
  }

  changes.forEach((change) =>
    console.info(
      `[schedule] ${userId}: rule ${change.id} dayOfMonth ${change.from ?? "none"} -> ${change.day} (start date's day, so payments stay where they were)`
    )
  );
  return changes.length;
};

/**
 * One-time, versioned step: a skipped loan / credit card / installment payment becomes an ordinary
 * UNPAID payment again (decision 2026-10-02: debt payments are owed, so they are moved or left
 * overdue, never skipped). A skip used to hide a payment that was still owed: the plan's remaining
 * schedule could no longer clear its balance.
 *
 * - A stored `skipped` row of a debt rule is deleted. It never moved the balance or the plan's
 *   progress (only completed rows do), so nothing else changes; the occurrence regenerates as a
 *   projection on its date and, once that date has passed, shows as overdue.
 * - A legacy `skipped: true` occurrence override on a debt rule is removed (the whole override when
 *   that was all it held, otherwise just the flag, so a moved date or amount is kept).
 *
 * `debtSkipModelVersion` on the profile makes it run once. The writes and the stamp go out together
 * (the stamp rides in the last batch, so a stopped run is simply re-run). Every change is logged.
 *
 * @returns the number of skipped debt payments restored
 */
export const migrateSkippedDebtPayments = async (userId: string): Promise<number> => {
  const profile = await getUserProfile(userId);
  if (!profile) return 0;
  if ((profile.debtSkipModelVersion ?? 0) >= DEBT_SKIP_MODEL_VERSION) return 0;

  const rulesSnap = await getDocs(query(collection(db, "expense_rules"), where("userId", "==", userId)));
  const debtRules = rulesSnap.docs.filter((d) => isDebtRule(d.data() as ExpenseRule));
  const debtIds = new Set(debtRules.map((d) => d.id));

  type Write = { describe: string; apply: (batch: ReturnType<typeof writeBatch>) => void };
  const writes: Write[] = [];

  if (debtIds.size > 0) {
    const txSnap = await getDocs(query(collection(db, "transactions"), where("userId", "==", userId)));
    txSnap.docs.forEach((d) => {
      const t = d.data() as Transaction;
      if (t.status !== "skipped" || t.sourceType !== "expense_rule" || !t.sourceId || !debtIds.has(t.sourceId)) return;
      writes.push({
        describe: `skipped row ${d.id} (${t.occurrenceId ?? t.scheduledDate}) of rule ${t.sourceId} removed`,
        apply: (batch) => batch.delete(d.ref),
      });
    });
    debtRules.forEach((d) => {
      const overrides = (d.data() as ExpenseRule).occurrenceOverrides ?? {};
      Object.entries(overrides).forEach(([occurrenceId, override]) => {
        if (!override?.skipped) return;
        const onlySkip = Object.keys(override).every((key) => key === "skipped");
        const field = onlySkip ? `occurrenceOverrides.${occurrenceId}` : `occurrenceOverrides.${occurrenceId}.skipped`;
        writes.push({
          describe: `skip flag on ${occurrenceId} of rule ${d.id} removed`,
          apply: (batch) => batch.update(d.ref, { [field]: deleteField(), updatedAt: Timestamp.now() }),
        });
      });
    });
  }

  const userRef = doc(db, "users", userId);
  const stamp = { debtSkipModelVersion: DEBT_SKIP_MODEL_VERSION, updatedAt: Timestamp.now() };
  const perBatch = MAX_BATCH_OPERATIONS - 1;
  for (let i = 0; i < Math.max(writes.length, 1); i += perBatch) {
    const batch = writeBatch(db);
    writes.slice(i, i + perBatch).forEach((w) => w.apply(batch));
    if (i + perBatch >= writes.length) batch.update(userRef, stamp);
    await batch.commit();
  }

  writes.forEach((w) => console.info(`[debt-skip] ${userId}: ${w.describe} (debt payments are owed, not skipped)`));
  return writes.length;
};

/**
 * Cleanup legacy partial payments:
 * - Reclassify partial transactions to "projected"
 * - Clear actualAmount/notes that were stored for partials
 * - Delete child remainder transactions linked via parentTransactionId
 */
export const normalizePartialTransactions = async (userId: string): Promise<void> => {
  const transactionsRef = collection(db, "transactions");

  // Fetch legacy partial transactions
  const partialQuery = query(
    transactionsRef,
    where("userId", "==", userId),
    where("status", "==", "partial")
  );
  const partialSnapshot = await getDocs(partialQuery);

  if (partialSnapshot.empty) return;

  const batch = writeBatch(db);

  // Track parent ids to clean up remainder children
  const parentIds: string[] = [];

  partialSnapshot.forEach((docSnap) => {
    parentIds.push(docSnap.id);
    batch.update(docSnap.ref, {
      status: "projected",
      actualAmount: null,
      actualDate: null,
      notes: null,
      updatedAt: Timestamp.now(),
    });
  });

  // Delete remainder children linked to partial parents
  if (parentIds.length > 0) {
    // Firestore "in" queries allow up to 10 values; chunk if needed
    for (let i = 0; i < parentIds.length; i += 10) {
      const chunk = parentIds.slice(i, i + 10);
      const remainderQuery = query(
        transactionsRef,
        where("userId", "==", userId),
        where("parentTransactionId", "in", chunk)
      );
      const remainderSnapshot = await getDocs(remainderQuery);
      remainderSnapshot.forEach((docSnap) => batch.delete(docSnap.ref));
    }
  }

  await batch.commit();
};
