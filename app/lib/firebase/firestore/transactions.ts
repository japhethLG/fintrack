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
import { Transaction } from "@/lib/types";
import { removeUndefined } from "./utils";
import { adjustUserBalance } from "./users";
import {
  getExpenseRule,
  updateExpenseRule,
  updateLoanBalance,
  updateInstallmentProgress,
} from "./expenseRules";

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
  if (options?.limit) {
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

export const completeTransaction = async (
  id: string,
  actualAmount: number,
  actualDate?: string,
  notes?: string
): Promise<void> => {
  const transaction = await getTransaction(id);
  if (!transaction) throw new Error("Transaction not found");

  // REVERSAL LOGIC: If already completed, reverse the old adjustment
  if (transaction.status === "completed") {
    const oldAmount = transaction.actualAmount ?? transaction.projectedAmount;
    const reversalDelta = transaction.type === "income" ? -oldAmount : oldAmount;
    await adjustUserBalance(transaction.userId, reversalDelta);
  }

  const variance = actualAmount - transaction.projectedAmount;

  await updateTransaction(id, {
    actualAmount,
    actualDate: actualDate || transaction.scheduledDate,
    variance,
    status: "completed",
    completedAt: Timestamp.now(),
    notes: notes || transaction.notes,
  });

  // Apply new balance adjustment
  const delta = transaction.type === "income" ? actualAmount : -actualAmount;
  await adjustUserBalance(transaction.userId, delta);

  // Update source balances if applicable (for loan/installment tracking)
  if (transaction.sourceType === "expense_rule" && transaction.sourceId) {
    const rule = await getExpenseRule(transaction.sourceId);
    if (rule?.loanConfig && transaction.paymentBreakdown) {
      await updateLoanBalance(
        transaction.sourceId,
        actualAmount,
        transaction.paymentBreakdown.principalPaid
      );
    } else if (rule?.installmentConfig) {
      await updateInstallmentProgress(transaction.sourceId);
    }
  }
};

export const skipTransaction = async (id: string, notes?: string): Promise<void> => {
  const transaction = await getTransaction(id);
  if (!transaction) throw new Error("Transaction not found");

  // If the transaction was previously completed, reverse its balance impact
  if (transaction.status === "completed") {
    const amount = transaction.actualAmount ?? transaction.projectedAmount;
    const reversalDelta = transaction.type === "income" ? -amount : amount;
    await adjustUserBalance(transaction.userId, reversalDelta);
  }

  await updateTransaction(id, {
    status: "skipped",
    notes,
  });
};

/**
 * Revert a stored transaction back to projected status.
 * This deletes the stored transaction, allowing it to regenerate as a projection.
 *
 * @param id - Transaction ID (must be a stored transaction, not proj_*)
 * @returns Object with scheduledDate if it should be preserved as an override
 */
export const revertToProjected = async (
  id: string
): Promise<{
  scheduledDate: string;
  sourceId: string;
  sourceType: "income_source" | "expense_rule";
  occurrenceId?: string;
} | null> => {
  const transaction = await getTransaction(id);
  if (!transaction) throw new Error("Transaction not found");

  // Cannot revert manual transactions - they have no source to project from
  if (transaction.sourceType === "manual") {
    throw new Error("Manual transactions cannot be reverted to projected");
  }

  // Must have a source to revert to
  if (!transaction.sourceId) {
    throw new Error("Transaction has no source to revert to");
  }

  // Reverse balance if was completed
  if (transaction.status === "completed") {
    const amount = transaction.actualAmount ?? transaction.projectedAmount;
    const reversalDelta = transaction.type === "income" ? -amount : amount;
    await adjustUserBalance(transaction.userId, reversalDelta);

    // Decrement loan/installment counters if applicable
    if (transaction.sourceType === "expense_rule") {
      const rule = await getExpenseRule(transaction.sourceId);
      if (rule?.loanConfig && rule.loanConfig.paymentsMade > 0) {
        await updateExpenseRule(transaction.sourceId, {
          loanConfig: {
            ...rule.loanConfig,
            paymentsMade: rule.loanConfig.paymentsMade - 1,
          },
        });
      } else if (rule?.installmentConfig && rule.installmentConfig.installmentsPaid > 0) {
        await updateExpenseRule(transaction.sourceId, {
          installmentConfig: {
            ...rule.installmentConfig,
            installmentsPaid: rule.installmentConfig.installmentsPaid - 1,
          },
        });
      }
    }
  }

  // Capture data before deletion for potential override creation
  const revertData = {
    scheduledDate: transaction.scheduledDate,
    sourceId: transaction.sourceId,
    sourceType: transaction.sourceType as "income_source" | "expense_rule",
    occurrenceId: transaction.occurrenceId,
  };

  // Delete the stored transaction - it will re-appear as a projection
  await deleteTransaction(id);

  return revertData;
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
  const batch = writeBatch(db);

  snapshot.docs.forEach((docSnapshot) => {
    const transaction = docSnapshot.data() as Transaction;
    if (!statusFilter || statusFilter.includes(transaction.status)) {
      batch.delete(docSnapshot.ref);
    }
  });

  await batch.commit();
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
 * Subscribe to stored transactions only (excludes projected status).
 * Used with on-the-fly projection computation - only fetches actual/completed transactions.
 * No date filtering - fetches all stored transactions for the user.
 */
export const subscribeToStoredTransactions = (
  userId: string,
  callback: (transactions: Transaction[]) => void
): (() => void) => {
  const transactionsRef = collection(db, "transactions");
  // Fetch all non-projected transactions (completed, skipped)
  const q = query(
    transactionsRef,
    where("userId", "==", userId),
    where("status", "in", ["completed", "skipped"]),
    orderBy("scheduledDate", "asc")
  );

  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction);
    callback(transactions);
  });
};
