/**
 * User Profile Operations
 * CRUD operations and real-time subscriptions for user profiles
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../config";
import { UserProfile } from "@/lib/types";
import { removeUndefined } from "./utils";

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
      initialBalance: 0,
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

export const deleteUserProfile = async (userId: string): Promise<void> => {
  const userRef = doc(db, "users", userId);
  const { deleteDoc } = await import("firebase/firestore");
  await deleteDoc(userRef);
};

