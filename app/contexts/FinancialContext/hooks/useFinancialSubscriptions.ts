import { useEffect, useRef, Dispatch, SetStateAction } from "react";
import { User } from "firebase/auth";
import { UserProfile, IncomeSource, ExpenseRule, Transaction, Alert } from "@/lib/types";
import {
  sanitizeExpenseRules,
  sanitizeIncomeSources,
  sanitizeTransactions,
  type DataIssue,
  type DataIssueKind,
} from "@/lib/utils/sanitizeData";
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
  /** Records the documents that failed validation at the ingestion boundary, per collection. */
  setDataIssues: (kind: DataIssueKind, issues: DataIssue[]) => void;
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
  setDataIssues,
  setIsLoading,
  setIsInitialized,
}: UseFinancialSubscriptionsParams) {
  // The uid whose data is currently in state. When it changes (user A -> B) A's lists are dropped
  // BEFORE B's are subscribed, so a first render for B can never pair B's profile with A's
  // transactions (the realized ledger and the balance would briefly disagree). A refreshed auth
  // object for the SAME uid (token refresh) keeps the data on screen.
  const loadedUid = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      loadedUid.current = null;
      // Reset state on logout
      setUserProfile(null);
      setIncomeSources([]);
      setExpenseRules([]);
      setStoredTransactions([]);
      setAlerts([]);
      setDataIssues("income_source", []);
      setDataIssues("expense_rule", []);
      setDataIssues("transaction", []);
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    if (loadedUid.current !== user.uid) {
      loadedUid.current = user.uid;
      setUserProfile(null);
      setIncomeSources([]);
      setExpenseRules([]);
      setStoredTransactions([]);
      setAlerts([]);
      setDataIssues("income_source", []);
      setDataIssues("expense_rule", []);
      setDataIssues("transaction", []);
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
      // Hostile / legacy documents are repaired here, once, and reported (never silently dropped)
      const { items, issues } = sanitizeIncomeSources(sources);
      setIncomeSources(items);
      setDataIssues("income_source", issues);
    });
    unsubscribers.push(unsubIncome);

    // Subscribe to expense rules
    const unsubExpenses = subscribeToExpenseRules(user.uid, (rules) => {
      const { items, issues } = sanitizeExpenseRules(rules);
      setExpenseRules(items);
      setDataIssues("expense_rule", issues);
    });
    unsubscribers.push(unsubExpenses);

    // Subscribe to stored transactions only (completed, skipped)
    // Projections are computed on-the-fly, not stored
    const unsubTransactions = subscribeToStoredTransactions(user.uid, (txns) => {
      const { items, issues } = sanitizeTransactions(txns);
      setStoredTransactions(items);
      setDataIssues("transaction", issues);
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
    setDataIssues,
    setIsLoading,
    setIsInitialized,
  ]);
}

