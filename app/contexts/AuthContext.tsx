"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User } from "firebase/auth";
import {
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  signOut,
  onAuthStateChanged,
  deleteCurrentUser,
  reauthenticateUser,
  reauthenticateWithGoogle,
  isGoogleOnlyUser,
} from "@/lib/firebase/auth";
import { DeletableDataType, UserProfile } from "@/lib/types";
import {
  getUserProfile,
  createUserProfile,
  deleteAllUserData,
  deleteSelectiveUserData,
  deleteAccountData,
  subscribeToUserProfile,
  migrateToInitialBalance,
  migrateLoanInstallmentDayOfMonth,
  migrateSkippedDebtPayments,
} from "@/lib/firebase/firestore";

export interface DeleteAccountCredentials {
  /** The account password (email users). Google users reauthenticate with the Google popup instead. */
  password?: string;
}

/** Thrown when the data is gone but the login could not be deleted; the user has been signed out. */
export class AccountDeletionIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionIncompleteError";
  }
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const describeReauthFailure = (error: unknown): string => {
  const reason = reasonOf(error);
  if (/auth\/(wrong-password|invalid-credential)/.test(reason)) {
    return "Incorrect password. Nothing was deleted.";
  }
  if (/auth\/(popup-closed-by-user|cancelled-popup-request|popup-blocked)/.test(reason)) {
    return "Google sign-in was cancelled or blocked. Nothing was deleted.";
  }
  if (/auth\/user-mismatch/.test(reason)) {
    return "That Google account is not the one you are signed in with. Nothing was deleted.";
  }
  if (/auth\/too-many-requests/.test(reason)) {
    return "Too many attempts. Please try again later. Nothing was deleted.";
  }
  return `We could not confirm your identity (${reason}). Nothing was deleted.`;
};

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Reauthenticates, deletes the data, then the login. Email users must pass their password. */
  deleteAccount: (credentials?: DeleteAccountCredentials) => Promise<void>;
  resetFinancialData: () => Promise<void>;
  resetSelectiveFinancialData: (dataTypes: DeletableDataType[]) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    // Each auth event gets a number. The profile set-up below awaits the network, and a
    // newer event (another user signed in, sign-out) must win: a slow set-up for the
    // PREVIOUS user must never subscribe that user's profile under the new session.
    let latestAuthEvent = 0;

    const unsubscribeAuth = onAuthStateChanged(async (user) => {
      const authEvent = ++latestAuthEvent;
      setUser(user);

      // Clean up previous profile subscription
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (user) {
        // Create profile if it doesn't exist
        try {
          await createUserProfile(user.uid, user.email || "", user.displayName || "User");
          // Run migration to ensure initialBalance field exists
          await migrateToInitialBalance(user.uid);
          // pin legacy loan / installment days so the engine's dayOfMonth moves nothing
          await migrateLoanInstallmentDayOfMonth(user.uid);
          // debt payments are owed: skipped ones from before become unpaid again
          await migrateSkippedDebtPayments(user.uid);
        } catch (error) {
          console.error("Error creating user profile or running migration:", error);
        }

        if (authEvent !== latestAuthEvent) return; // superseded while setting up

        // Subscribe to real-time profile updates
        unsubscribeProfile = subscribeToUserProfile(user.uid, (profile) => {
          setUserProfile(profile);
          setLoading(false);
        });
      } else {
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmail(email, password);
  };

  const loginWithGoogle = async () => {
    await signInWithGoogle();
  };

  const signup = async (email: string, password: string) => {
    await signUpWithEmail(email, password);
  };

  const logout = async () => {
    await signOut();
    setUserProfile(null);
  };

  const deleteAccount = async (credentials?: DeleteAccountCredentials) => {
    if (!user) throw new Error("No user logged in");

    const uid = user.uid;

    // ORDER (UI-BAL-23, safety-critical). With real security rules every data write needs an
    // AUTHENTICATED caller, so the login must outlive the data deletion; and the login is the step
    // Firebase refuses with "requires-recent-login". Hence:
    //   (a) reauthenticate first (password for email users, Google popup for Google users): a stale
    //       session or a wrong password stops here with nothing touched;
    //   (b) delete the data and the profile (one atomic batch): a failure leaves the account whole;
    //   (c) delete the auth user. If only this fails, the data is already gone: tell the user plainly and
    //       sign them out (they can retry; an empty signed-in account is never left behind).
    // The first await is the reauthentication itself, so a Google popup still counts as user-initiated.
    try {
      if (isGoogleOnlyUser(user)) {
        await reauthenticateWithGoogle();
      } else {
        if (!credentials?.password) {
          throw new Error("Enter your password to confirm. Nothing was deleted.");
        }
        await reauthenticateUser(credentials.password);
      }
    } catch (error) {
      throw new Error(describeReauthFailure(error));
    }

    try {
      await deleteAccountData(uid);
    } catch (error) {
      throw new Error(
        `Your account was not deleted: your data could not be removed (${reasonOf(error)}). ` +
          "Nothing was changed. Please try again."
      );
    }

    try {
      await deleteCurrentUser();
    } catch (error) {
      try {
        await signOut();
      } catch {
        // already failing; the message below is what matters
      }
      setUserProfile(null);
      setUser(null);
      throw new AccountDeletionIncompleteError(
        `Your data was deleted, but we could not remove your sign-in (${reasonOf(error)}). ` +
          "You have been signed out. Sign in again and use Delete Account to finish, or contact support."
      );
    }

    // Clear local state
    setUserProfile(null);
    setUser(null);
  };

  const resetFinancialData = async () => {
    if (!user) throw new Error("No user logged in");

    // Delete all financial data (keeps profile)
    await deleteAllUserData(user.uid);

    // Refresh user profile to get updated balance
    const profile = await getUserProfile(user.uid);
    if (profile) {
      setUserProfile(profile);
    }
  };

  const resetSelectiveFinancialData = async (dataTypes: DeletableDataType[]) => {
    if (!user) throw new Error("No user logged in");

    await deleteSelectiveUserData(user.uid, dataTypes);

    // Refresh user profile to get updated balance if it changed
    const profile = await getUserProfile(user.uid);
    if (profile) {
      setUserProfile(profile);
    }
  };

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    login,
    loginWithGoogle,
    signup,
    logout,
    deleteAccount,
    resetFinancialData,
    resetSelectiveFinancialData,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
