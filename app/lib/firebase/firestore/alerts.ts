/**
 * Alert Operations
 * CRUD operations and real-time subscriptions for user alerts
 */

import {
  collection,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  getDocs,
  Timestamp,
  orderBy,
  onSnapshot,
  limit,
  QueryConstraint,
} from "firebase/firestore";
import { db } from "../config";
import { Alert } from "@/lib/types";
import { removeUndefined } from "./utils";

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
