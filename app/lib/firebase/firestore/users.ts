/**
 * User Profile Operations
 * CRUD operations and real-time subscriptions for user profiles
 */

import {
  doc,
  getDoc,
  updateDoc,
  runTransaction,
  Timestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../config";
import { UserProfile } from "@/lib/types";
import { removeUndefined } from "./utils";
import { getTodayKey } from "@/lib/utils/dateUtils";
import { cleanMoney } from "@/lib/logic/balanceCalculator/ledgerMath";

/** The balance model new profiles are created on (see UserProfile.balanceModelVersion). */
export const BALANCE_MODEL_VERSION = 1;

/** The schedule-data model new profiles are created on (see UserProfile.scheduleModelVersion). */
export const SCHEDULE_MODEL_VERSION = 1;

export const createUserProfile = async (
  uid: string,
  email: string,
  displayName: string
): Promise<UserProfile> => {
  const userRef = doc(db, "users", uid);
  // Create-if-absent in one transaction: two tabs signing in at the same moment
  // cannot both create (and the loser overwrite) the profile.
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(userRef);
    if (snapshot.exists()) return snapshot.data() as UserProfile;

    const now = Timestamp.now();
    const newProfile: UserProfile = {
      uid,
      email,
      displayName,
      currentBalance: 0,
      initialBalance: 0,
      balanceLastUpdatedAt: getTodayKey(),
      balanceModelVersion: BALANCE_MODEL_VERSION,
      scheduleModelVersion: SCHEDULE_MODEL_VERSION,
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
    tx.set(userRef, newProfile);
    return newProfile;
  });
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
    balanceLastUpdatedAt: getTodayKey(),
    updatedAt: Timestamp.now(),
  });

  await updateDoc(userRef, cleanedUpdates);
};

/**
 * Add `delta` to the stored balance, atomically. The read and the write happen in
 * one transaction, so two adjustments in flight cannot lose one of them. (Gestures
 * on transactions do NOT use this: they change the balance inside the same
 * transaction as the row; see ledger.ts.)
 */
export const adjustUserBalance = async (uid: string, delta: number): Promise<number> => {
  const userRef = doc(db, "users", uid);
  return runTransaction(db, async (tx) => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists()) throw new Error("User profile not found");
    const current = (snapshot.data() as UserProfile).currentBalance;
    const newBalance = cleanMoney(current + delta);
    tx.update(userRef, {
      currentBalance: newBalance,
      balanceLastUpdatedAt: getTodayKey(),
      updatedAt: Timestamp.now(),
    });
    return newBalance;
  });
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

export const deleteUserProfile = async (userId: string): Promise<void> => {
  const userRef = doc(db, "users", userId);
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(userRef);
};

