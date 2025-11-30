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
} from "firebase/firestore";
import { db } from "../config";
import { Transaction } from "@/lib/types";
import { getUserProfile, updateUserProfile } from "./users";

/**
 * Delete all projected transactions for a user.
 * This is a one-time migration utility to clean up when switching to on-the-fly projections.
 * Only deletes transactions with status "projected" - completed, skipped, partial, and pending are preserved.
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

