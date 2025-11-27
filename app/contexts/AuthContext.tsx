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
import { UserProfile } from "@/lib/types";
import {
  getUserProfile,
  createUserProfile,
  deleteAllUserData,
  deleteUserProfile,
  subscribeToUserProfile,
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

    const unsubscribeAuth = onAuthStateChanged(async (user) => {
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
        } catch (error) {
          console.error("Error creating user profile:", error);
        }

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

    // Delete all user data from Firestore
    await deleteAllUserData(user.uid);

    // Delete user profile document
    await deleteUserProfile(user.uid);

    // Delete Firebase Auth user (must be done last)
    await deleteCurrentUser();

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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
