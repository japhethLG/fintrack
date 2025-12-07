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
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { db } from "../config";
import { DeletableDataType, Transaction } from "@/lib/types";
import { getUserProfile, updateUserProfile } from "./users";
import {
  getIncomeSource,
  getExpenseRule,
  setIncomeSourceOverride,
  setExpenseRuleOverride,
} from "./index";
import { parseDate } from "@/lib/utils/dateUtils";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";

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

  // Delete in batches (Firestore limit is 500 operations per batch)
  const batchSize = 500;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = writeBatch(db);
    const chunk = docs.slice(i, i + batchSize);
    chunk.forEach((docSnapshot) => {
      batch.delete(docSnapshot.ref);
    });
    await batch.commit();
  }

  return docs.length;
};

/**
 * Delete all financial data for a user (income sources, expense rules, transactions, balance history, alerts)
 * This resets the user's financial data but keeps their profile.
 */
export const deleteAllUserData = async (userId: string): Promise<void> => {
  const collections = [
    "income_sources",
    "expense_rules",
    "transactions",
    "balance_history",
    "alerts",
  ];

  for (const collectionName of collections) {
    const collRef = collection(db, collectionName);
    const q = query(collRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);

    // Delete in batches (Firestore limit is 500 operations per batch)
    const batchSize = 500;
    const docs = snapshot.docs;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + batchSize);
      chunk.forEach((docSnapshot) => {
        batch.delete(docSnapshot.ref);
      });
      await batch.commit();
    }
  }

  // Reset user balance to 0
  await updateUserProfile(userId, {
    currentBalance: 0,
    balanceLastUpdatedAt: new Date().toISOString().split("T")[0],
  });
};

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
  const batch = writeBatch(db);

  for (const docSnap of snapshot.docs) {
    const txn = docSnap.data() as Transaction;
    if (!txn.sourceId || !txn.sourceType) {
      batch.delete(docSnap.ref);
      migrated++;
      continue;
    }

    const isIncome = txn.sourceType === "income_source";
    const source = isIncome
      ? await getIncomeSource(txn.sourceId)
      : await getExpenseRule(txn.sourceId);

    if (!source) {
      batch.delete(docSnap.ref);
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

    batch.delete(docSnap.ref);
    migrated++;
  }

  await batch.commit();
  return migrated;
};

/**
 * Delete selected financial data collections for a user.
 * Resets balance to 0 only when transactions or balance history are deleted.
 */
export const deleteSelectiveUserData = async (
  userId: string,
  dataTypes: DeletableDataType[]
): Promise<void> => {
  if (dataTypes.length === 0) return;

  const uniqueTypes = Array.from(new Set<DeletableDataType>(dataTypes));

  for (const collectionName of uniqueTypes) {
    const collRef = collection(db, collectionName);
    const q = query(collRef, where("userId", "==", userId));
    const snapshot = await getDocs(q);

    const docs = snapshot.docs;
    const batchSize = 500;

    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = writeBatch(db);
      const chunk = docs.slice(i, i + batchSize);
      chunk.forEach((docSnapshot) => {
        batch.delete(docSnapshot.ref);
      });
      await batch.commit();
    }
  }

  const shouldResetBalance =
    uniqueTypes.includes("transactions") || uniqueTypes.includes("balance_history");

  if (shouldResetBalance) {
    await updateUserProfile(userId, {
      currentBalance: 0,
      balanceLastUpdatedAt: new Date().toISOString().split("T")[0],
    });
  }
};

/**
 * Migrate user profile to include initialBalance field
 * If initialBalance doesn't exist, set it to currentBalance (preserving existing balance state)
 * This ensures backward compatibility with existing user data
 */
export const migrateToInitialBalance = async (userId: string): Promise<void> => {
  const profile = await getUserProfile(userId);
  if (!profile) return;

  // If initialBalance doesn't exist, set it to currentBalance
  // This preserves the existing balance state for users who were already using the app
  if (profile.initialBalance === undefined || profile.initialBalance === null) {
    await updateUserProfile(userId, {
      initialBalance: profile.currentBalance,
    });
  }
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

