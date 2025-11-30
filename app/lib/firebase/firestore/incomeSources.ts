/**
 * Income Source Operations
 * CRUD operations and real-time subscriptions for income sources
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
import { IncomeSource } from "@/lib/types";
import { removeUndefined } from "./utils";

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

