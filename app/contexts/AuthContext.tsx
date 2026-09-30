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
} from "@/lib/firebase/firestore";

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
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

  const deleteAccount = async () => {
    if (!user) throw new Error("No user logged in");

    const uid = user.uid;

    // ORDER (UI-BAL-23). The login goes FIRST: it is the step Firebase refuses when the
    // session is not recent ("requires-recent-login") or the network fails, and while it has
    // not succeeded nothing has been touched, so the user keeps a whole account and can
    // retry. Deleting the data first left a signed-in, empty account behind whenever this
    // step failed. The data then goes in one atomic batch (profile document included).
    await deleteCurrentUser();

    try {
      await deleteAccountData(uid);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Your sign-in was deleted, but your stored data could not be removed (${reason}). ` +
          "Contact support to have it erased."
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
