/**
 * Expense Rule Operations
 * CRUD operations and real-time subscriptions for expense rules
 * Includes special handlers for loans, credit cards, and installments
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
  onSnapshot,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "../config";
import { ExpenseRule } from "@/lib/types";
import { removeUndefined } from "./utils";

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

