/**
 * Balance History Operations
 * Operations for storing and retrieving balance snapshots over time
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "../config";
import { BalanceSnapshot } from "@/lib/types";
import { removeUndefined } from "./utils";

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

