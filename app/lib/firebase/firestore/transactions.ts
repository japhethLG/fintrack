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
import { getExpenseRule, updateLoanBalance, updateInstallmentProgress } from "./expenseRules";

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

  // REVERSAL LOGIC: If already completed/partial, reverse the old adjustment
  if (transaction.status === "completed" || transaction.status === "partial") {
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
  await updateTransaction(id, {
    status: "skipped",
    notes,
  });
};

/**
 * Delete remainder transactions created from a partial payment
 * @param parentTransactionId - ID of the parent partial transaction
 */
const deleteRemainderTransactions = async (parentTransactionId: string): Promise<void> => {
  const transactionsRef = collection(db, "transactions");
  const q = query(
    transactionsRef,
    where("parentTransactionId", "==", parentTransactionId),
    where("status", "==", "pending")
  );
  const snapshot = await getDocs(q);
  await Promise.all(snapshot.docs.map((doc) => deleteDoc(doc.ref)));
};

export const partialPayTransaction = async (
  id: string,
  partialAmount: number,
  notes?: string
): Promise<Transaction> => {
  const transaction = await getTransaction(id);
  if (!transaction) throw new Error("Transaction not found");

  // REVERSAL: If already partial, delete old remainder and reverse old adjustment
  if (transaction.status === "partial") {
    const oldAmount = transaction.actualAmount ?? 0;
    const reversalDelta = transaction.type === "income" ? -oldAmount : oldAmount;
    await adjustUserBalance(transaction.userId, reversalDelta);

    // Delete old remainder transaction
    await deleteRemainderTransactions(transaction.id);
  }

  // Update original transaction
  await updateTransaction(id, {
    actualAmount: partialAmount,
    status: "partial",
    notes,
  });

  // Apply new balance adjustment
  const delta = transaction.type === "income" ? partialAmount : -partialAmount;
  await adjustUserBalance(transaction.userId, delta);

  // Create new remainder transaction
  const remainder = transaction.projectedAmount - partialAmount;
  const nextWeek = new Date(transaction.scheduledDate);
  nextWeek.setDate(nextWeek.getDate() + 7);

  // Format date as YYYY-MM-DD using local time
  const year = nextWeek.getFullYear();
  const month = String(nextWeek.getMonth() + 1).padStart(2, "0");
  const day = String(nextWeek.getDate()).padStart(2, "0");
  const nextWeekStr = `${year}-${month}-${day}`;

  const remainderTransaction = await addTransaction(transaction.userId, {
    name: `${transaction.name} (Remainder)`,
    type: transaction.type,
    category: transaction.category,
    sourceType: transaction.sourceType,
    sourceId: transaction.sourceId,
    projectedAmount: remainder,
    scheduledDate: nextWeekStr,
    status: "pending",
    parentTransactionId: id, // Link to parent for cleanup
  });

  return remainderTransaction;
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
  // Fetch all non-projected transactions (completed, skipped, partial, pending)
  const q = query(
    transactionsRef,
    where("userId", "==", userId),
    where("status", "in", ["completed", "skipped", "partial", "pending"]),
    orderBy("scheduledDate", "asc")
  );

  return onSnapshot(q, (snapshot) => {
    const transactions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Transaction);
    callback(transactions);
  });
};

