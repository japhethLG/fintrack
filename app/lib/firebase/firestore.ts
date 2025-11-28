import {
  collection,
  doc,
  getDoc,
  setDoc,
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
import { db } from "./config";
import {
  UserProfile,
  Transaction,
  IncomeSource,
  ExpenseRule,
  BalanceSnapshot,
  Alert,
} from "@/lib/types";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Remove undefined values from an object before writing to Firestore.
 * Firestore doesn't allow undefined values - use null or omit the field.
 */
const removeUndefined = <T extends Record<string, unknown>>(obj: T): Partial<T> => {
  const cleaned: Record<string, unknown> = {};
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (value !== undefined) {
      cleaned[key] = value;
    }
  });
  return cleaned as Partial<T>;
};

// ============================================================================
// USER PROFILE
// ============================================================================

export const createUserProfile = async (
  uid: string,
  email: string,
  displayName: string
): Promise<UserProfile> => {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    const now = Timestamp.now();
    const newProfile: UserProfile = {
      uid,
      email,
      displayName,
      currentBalance: 0,
      balanceLastUpdatedAt: new Date().toISOString().split("T")[0],
      preferences: {
        currency: "PHP",
        dateFormat: "MM/DD/YYYY",
        startOfWeek: 0,
        theme: "dark",
        defaultWarningThreshold: 500,
      },
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(userRef, newProfile);
    return newProfile;
  }
  return snapshot.data() as UserProfile;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  const userRef = doc(db, "users", uid);
  const snapshot = await getDoc(userRef);
  if (snapshot.exists()) {
    return snapshot.data() as UserProfile;
  }
  return null;
};

export const updateUserProfile = async (
  uid: string,
  updates: Partial<Omit<UserProfile, "uid" | "createdAt">>
): Promise<void> => {
  const userRef = doc(db, "users", uid);

  // Check if document exists before updating
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    throw new Error(`User profile with ID ${uid} does not exist`);
  }

  // Remove undefined values before updating
  const cleanedUpdates = removeUndefined({
    ...updates,
    updatedAt: Timestamp.now(),
  });

  await updateDoc(userRef, cleanedUpdates);
};

export const updateUserBalance = async (uid: string, newBalance: number): Promise<void> => {
  const userRef = doc(db, "users", uid);

  // Check if document exists before updating
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    throw new Error(`User profile with ID ${uid} does not exist`);
  }

  // Remove undefined values before updating
  const cleanedUpdates = removeUndefined({
    currentBalance: newBalance,
    balanceLastUpdatedAt: new Date().toISOString().split("T")[0],
    updatedAt: Timestamp.now(),
  });

  await updateDoc(userRef, cleanedUpdates);
};

export const adjustUserBalance = async (uid: string, delta: number): Promise<number> => {
  const profile = await getUserProfile(uid);
  if (!profile) throw new Error("User profile not found");

  const newBalance = profile.currentBalance + delta;
  await updateUserBalance(uid, newBalance);
  return newBalance;
};

// Real-time listener for user profile
export const subscribeToUserProfile = (
  uid: string,
  callback: (profile: UserProfile | null) => void
): (() => void) => {
  const userRef = doc(db, "users", uid);
  return onSnapshot(userRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data() as UserProfile);
    } else {
      callback(null);
    }
  });
};

// ============================================================================
// INCOME SOURCES
// ============================================================================

export const addIncomeSource = async (
  userId: string,
  source: Omit<IncomeSource, "id" | "userId" | "createdAt" | "updatedAt">
): Promise<IncomeSource> => {
  const now = Timestamp.now();
  // Remove undefined values before writing to Firestore
  const cleanedData = removeUndefined({
    ...source,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(collection(db, "income_sources"), cleanedData);
  return { id: docRef.id, userId, createdAt: now, updatedAt: now, ...source };
};

export const getIncomeSources = async (
  userId: string,
  activeOnly: boolean = false
): Promise<IncomeSource[]> => {
  const sourcesRef = collection(db, "income_sources");
  const constraints: QueryConstraint[] = [where("userId", "==", userId)];

  if (activeOnly) {
    constraints.push(where("isActive", "==", true));
  }

  const q = query(sourcesRef, ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as IncomeSource);
};

export const getIncomeSource = async (id: string): Promise<IncomeSource | null> => {
  const docRef = doc(db, "income_sources", id);
  const snapshot = await getDoc(docRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() } as IncomeSource;
  }
  return null;
};

export const updateIncomeSource = async (
  id: string,
  updates: Partial<Omit<IncomeSource, "id" | "userId" | "createdAt">>
): Promise<void> => {
  const docRef = doc(db, "income_sources", id);

  // Check if document exists before updating
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Income source with ID ${id} does not exist`);
  }

  // Remove undefined values before updating
  const cleanedUpdates = removeUndefined({
    ...updates,
    updatedAt: Timestamp.now(),
  });

  await updateDoc(docRef, cleanedUpdates);
};

export const deleteIncomeSource = async (id: string): Promise<void> => {
  const docRef = doc(db, "income_sources", id);
  await deleteDoc(docRef);
};

// Real-time listener for income sources
export const subscribeToIncomeSources = (
  userId: string,
  callback: (sources: IncomeSource[]) => void,
  activeOnly: boolean = false
): (() => void) => {
  const sourcesRef = collection(db, "income_sources");
  const constraints: QueryConstraint[] = [where("userId", "==", userId)];

  if (activeOnly) {
    constraints.push(where("isActive", "==", true));
  }

  const q = query(sourcesRef, ...constraints);
  return onSnapshot(q, (snapshot) => {
    const sources = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as IncomeSource);
    callback(sources);
  });
};

// ============================================================================
// EXPENSE RULES
// ============================================================================

export const addExpenseRule = async (
  userId: string,
  rule: Omit<ExpenseRule, "id" | "userId" | "createdAt" | "updatedAt">
): Promise<ExpenseRule> => {
  const now = Timestamp.now();
  // Remove undefined values before writing to Firestore
  const cleanedData = removeUndefined({
    ...rule,
    userId,
    createdAt: now,
    updatedAt: now,
  });
  const docRef = await addDoc(collection(db, "expense_rules"), cleanedData);
  return { id: docRef.id, userId, createdAt: now, updatedAt: now, ...rule };
};

export const getExpenseRules = async (
  userId: string,
  activeOnly: boolean = false
): Promise<ExpenseRule[]> => {
  const rulesRef = collection(db, "expense_rules");
  const constraints: QueryConstraint[] = [where("userId", "==", userId)];

  if (activeOnly) {
    constraints.push(where("isActive", "==", true));
  }

  const q = query(rulesRef, ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ExpenseRule);
};

export const getExpenseRule = async (id: string): Promise<ExpenseRule | null> => {
  const docRef = doc(db, "expense_rules", id);
  const snapshot = await getDoc(docRef);
  if (snapshot.exists()) {
    return { id: snapshot.id, ...snapshot.data() } as ExpenseRule;
  }
  return null;
};

export const updateExpenseRule = async (
  id: string,
  updates: Partial<Omit<ExpenseRule, "id" | "userId" | "createdAt">>
): Promise<void> => {
  const docRef = doc(db, "expense_rules", id);

  // Check if document exists before updating
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Expense rule with ID ${id} does not exist`);
  }

  // Remove undefined values before updating
  const cleanedUpdates = removeUndefined({
    ...updates,
    updatedAt: Timestamp.now(),
  });

  await updateDoc(docRef, cleanedUpdates);
};

export const deleteExpenseRule = async (id: string): Promise<void> => {
  const docRef = doc(db, "expense_rules", id);
  await deleteDoc(docRef);
};

// Update loan balance after payment
export const updateLoanBalance = async (
  ruleId: string,
  paymentAmount: number,
  principalPaid: number
): Promise<void> => {
  const rule = await getExpenseRule(ruleId);
  if (!rule || !rule.loanConfig) return;

  const newBalance = Math.max(0, rule.loanConfig.currentBalance - principalPaid);
  const newPaymentsMade = rule.loanConfig.paymentsMade + 1;

  await updateExpenseRule(ruleId, {
    loanConfig: {
      ...rule.loanConfig,
      currentBalance: newBalance,
      paymentsMade: newPaymentsMade,
    },
    // Deactivate if paid off
    isActive: newBalance > 0,
  });
};

// Update credit card balance
export const updateCreditBalance = async (ruleId: string, newBalance: number): Promise<void> => {
  const rule = await getExpenseRule(ruleId);
  if (!rule || !rule.creditConfig) return;

  await updateExpenseRule(ruleId, {
    creditConfig: {
      ...rule.creditConfig,
      currentBalance: newBalance,
    },
  });
};

// Update installment progress
export const updateInstallmentProgress = async (ruleId: string): Promise<void> => {
  const rule = await getExpenseRule(ruleId);
  if (!rule || !rule.installmentConfig) return;

  const newPaid = rule.installmentConfig.installmentsPaid + 1;
  const isComplete = newPaid >= rule.installmentConfig.installmentCount;

  await updateExpenseRule(ruleId, {
    installmentConfig: {
      ...rule.installmentConfig,
      installmentsPaid: newPaid,
    },
    isActive: !isComplete,
  });
};

// Real-time listener for expense rules
export const subscribeToExpenseRules = (
  userId: string,
  callback: (rules: ExpenseRule[]) => void,
  activeOnly: boolean = false
): (() => void) => {
  const rulesRef = collection(db, "expense_rules");
  const constraints: QueryConstraint[] = [where("userId", "==", userId)];

  if (activeOnly) {
    constraints.push(where("isActive", "==", true));
  }

  const q = query(rulesRef, ...constraints);
  return onSnapshot(q, (snapshot) => {
    const rules = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ExpenseRule);
    callback(rules);
  });
};

// ============================================================================
// TRANSACTIONS
// ============================================================================

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

  const variance = actualAmount - transaction.projectedAmount;

  await updateTransaction(id, {
    actualAmount,
    actualDate: actualDate || transaction.scheduledDate,
    variance,
    status: "completed",
    completedAt: Timestamp.now(),
    notes: notes || transaction.notes,
  });

  // Update user's current balance to reflect actual bank balance
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

export const partialPayTransaction = async (
  id: string,
  partialAmount: number,
  notes?: string
): Promise<Transaction> => {
  const transaction = await getTransaction(id);
  if (!transaction) throw new Error("Transaction not found");

  // Update original transaction
  await updateTransaction(id, {
    actualAmount: partialAmount,
    status: "partial",
    notes,
  });

  // Update user's current balance to reflect actual bank balance
  const delta = transaction.type === "income" ? partialAmount : -partialAmount;
  await adjustUserBalance(transaction.userId, delta);

  // Create remainder transaction
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

// ============================================================================
// BALANCE HISTORY
// ============================================================================

export const saveBalanceSnapshot = async (
  userId: string,
  snapshot: Omit<BalanceSnapshot, "id" | "userId" | "createdAt">
): Promise<BalanceSnapshot> => {
  const now = Timestamp.now();

  // Check if snapshot already exists for this date
  const existingSnapshot = await getBalanceSnapshot(userId, snapshot.date);

  if (existingSnapshot) {
    // Update existing
    const cleanedUpdate = removeUndefined({
      ...snapshot,
      createdAt: now,
    });
    await updateDoc(doc(db, "balance_history", existingSnapshot.id), cleanedUpdate);
    return { ...existingSnapshot, ...snapshot };
  }

  // Create new
  const cleanedData = removeUndefined({
    ...snapshot,
    userId,
    createdAt: now,
  });
  const docRef = await addDoc(collection(db, "balance_history"), cleanedData);
  return { id: docRef.id, userId, createdAt: now, ...snapshot };
};

export const getBalanceSnapshot = async (
  userId: string,
  date: string
): Promise<BalanceSnapshot | null> => {
  const historyRef = collection(db, "balance_history");
  const q = query(historyRef, where("userId", "==", userId), where("date", "==", date), limit(1));

  const snapshot = await getDocs(q);
  if (snapshot.empty) return null;

  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as BalanceSnapshot;
};

export const getBalanceHistory = async (
  userId: string,
  startDate: string,
  endDate: string
): Promise<BalanceSnapshot[]> => {
  const historyRef = collection(db, "balance_history");
  const q = query(
    historyRef,
    where("userId", "==", userId),
    where("date", ">=", startDate),
    where("date", "<=", endDate),
    orderBy("date", "asc")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as BalanceSnapshot);
};

// ============================================================================
// ALERTS
// ============================================================================

export const createAlert = async (
  userId: string,
  alert: Omit<Alert, "id" | "userId" | "createdAt" | "isRead" | "isDismissed">
): Promise<Alert> => {
  const now = Timestamp.now();
  // Remove undefined values before writing to Firestore
  const cleanedData = removeUndefined({
    ...alert,
    userId,
    isRead: false,
    isDismissed: false,
    createdAt: now,
  });
  const docRef = await addDoc(collection(db, "alerts"), cleanedData);
  return { id: docRef.id, userId, isRead: false, isDismissed: false, createdAt: now, ...alert };
};

export const getAlerts = async (
  userId: string,
  options?: {
    unreadOnly?: boolean;
    limit?: number;
  }
): Promise<Alert[]> => {
  const alertsRef = collection(db, "alerts");
  const constraints: QueryConstraint[] = [
    where("userId", "==", userId),
    where("isDismissed", "==", false),
    orderBy("createdAt", "desc"),
  ];

  if (options?.unreadOnly) {
    constraints.push(where("isRead", "==", false));
  }
  if (options?.limit) {
    constraints.push(limit(options.limit));
  }

  const q = query(alertsRef, ...constraints);
  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Alert);
};

export const markAlertAsRead = async (id: string): Promise<void> => {
  const docRef = doc(db, "alerts", id);

  // Check if document exists before updating
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Alert with ID ${id} does not exist`);
  }

  await updateDoc(docRef, { isRead: true });
};

export const dismissAlert = async (id: string): Promise<void> => {
  const docRef = doc(db, "alerts", id);

  // Check if document exists before updating
  const snapshot = await getDoc(docRef);
  if (!snapshot.exists()) {
    throw new Error(`Alert with ID ${id} does not exist`);
  }

  await updateDoc(docRef, { isDismissed: true });
};

export const subscribeToAlerts = (
  userId: string,
  callback: (alerts: Alert[]) => void
): (() => void) => {
  const alertsRef = collection(db, "alerts");
  const q = query(
    alertsRef,
    where("userId", "==", userId),
    where("isDismissed", "==", false),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  return onSnapshot(q, (snapshot) => {
    const alerts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Alert);
    callback(alerts);
  });
};

// ============================================================================
// MIGRATION UTILITIES
// ============================================================================

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

// ============================================================================
// USER DATA MANAGEMENT
// ============================================================================

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
 * Delete user profile document from Firestore
 */
export const deleteUserProfile = async (userId: string): Promise<void> => {
  const userRef = doc(db, "users", userId);
  await deleteDoc(userRef);
};
