import { useEffect, Dispatch, SetStateAction } from "react";
import { User } from "firebase/auth";
import { UserProfile, IncomeSource, ExpenseRule, Transaction, Alert } from "@/lib/types";
import {
  subscribeToUserProfile,
  subscribeToIncomeSources,
  subscribeToExpenseRules,
  subscribeToStoredTransactions,
  subscribeToAlerts,
} from "@/lib/firebase/firestore";

interface UseFinancialSubscriptionsParams {
  user: User | null;
  authLoading: boolean;
  setUserProfile: Dispatch<SetStateAction<UserProfile | null>>;
  setIncomeSources: Dispatch<SetStateAction<IncomeSource[]>>;
  setExpenseRules: Dispatch<SetStateAction<ExpenseRule[]>>;
  setStoredTransactions: Dispatch<SetStateAction<Transaction[]>>;
  setAlerts: Dispatch<SetStateAction<Alert[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsInitialized: Dispatch<SetStateAction<boolean>>;
}

/**
 * Hook to manage real-time subscriptions to financial data
 * Handles subscription setup, cleanup, and loading states
 */
export function useFinancialSubscriptions({
  user,
  authLoading,
  setUserProfile,
  setIncomeSources,
  setExpenseRules,
  setStoredTransactions,
  setAlerts,
  setIsLoading,
  setIsInitialized,
}: UseFinancialSubscriptionsParams) {
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Reset state on logout
      setUserProfile(null);
      setIncomeSources([]);
      setExpenseRules([]);
      setStoredTransactions([]);
      setAlerts([]);
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    setIsLoading(true);
    const unsubscribers: (() => void)[] = [];

    // Subscribe to user profile
    const unsubProfile = subscribeToUserProfile(user.uid, (profile) => {
      setUserProfile(profile);
    });
    unsubscribers.push(unsubProfile);

    // Subscribe to income sources
    const unsubIncome = subscribeToIncomeSources(user.uid, (sources) => {
      setIncomeSources(sources);
    });
    unsubscribers.push(unsubIncome);

    // Subscribe to expense rules
    const unsubExpenses = subscribeToExpenseRules(user.uid, (rules) => {
      setExpenseRules(rules);
    });
    unsubscribers.push(unsubExpenses);

    // Subscribe to stored transactions only (completed, skipped)
    // Projections are computed on-the-fly, not stored
    const unsubTransactions = subscribeToStoredTransactions(user.uid, (txns) => {
      setStoredTransactions(txns);
    });
    unsubscribers.push(unsubTransactions);

    // Subscribe to alerts
    const unsubAlerts = subscribeToAlerts(user.uid, (alertsList) => {
      setAlerts(alertsList);
    });
    unsubscribers.push(unsubAlerts);

    // Mark as loaded after initial data fetch
    const timer = setTimeout(() => {
      setIsLoading(false);
      setIsInitialized(true);
    }, 1000);

    return () => {
      unsubscribers.forEach((unsub) => unsub());
      clearTimeout(timer);
    };
  }, [
    user,
    authLoading,
    setUserProfile,
    setIncomeSources,
    setExpenseRules,
    setStoredTransactions,
    setAlerts,
    setIsLoading,
    setIsInitialized,
  ]);
}

