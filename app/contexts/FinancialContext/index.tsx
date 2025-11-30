"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "../AuthContext";
import { UserProfile, IncomeSource, ExpenseRule, Transaction, Alert } from "@/lib/types";
import { FinancialContextValue } from "./types";
import { mergeTransactionsWithProjections } from "./utils/projectionMerger";
import { useDailyBalances, useBillCoverage, useUpcomingBills } from "./hooks/useComputedFinancials";
import { useViewDateRange } from "./hooks/useViewDateRange";
import { useFinancialSubscriptions } from "./hooks/useFinancialSubscriptions";
import { useFinancialActions } from "./hooks/useFinancialActions";

// ============================================================================
// CONTEXT CREATION
// ============================================================================

const FinancialContext = createContext<FinancialContextValue | null>(null);

export const useFinancial = (): FinancialContextValue => {
  const context = useContext(FinancialContext);
  if (!context) {
    throw new Error("useFinancial must be used within a FinancialProvider");
  }
  return context;
};

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

interface FinancialProviderProps {
  children: ReactNode;
}

export const FinancialProvider: React.FC<FinancialProviderProps> = ({ children }) => {
  const { user, loading: authLoading } = useAuth();

  // State
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [expenseRules, setExpenseRules] = useState<ExpenseRule[]>([]);
  const [storedTransactions, setStoredTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Refs for use in callbacks (avoids recreating callbacks when these change)
  const incomeSourcesRef = useRef<IncomeSource[]>([]);
  const expenseRulesRef = useRef<ExpenseRule[]>([]);

  // Keep refs in sync with state
  useEffect(() => {
    incomeSourcesRef.current = incomeSources;
  }, [incomeSources]);

  useEffect(() => {
    expenseRulesRef.current = expenseRules;
  }, [expenseRules]);

  // View date range management
  const { viewDateRange, setViewDateRange } = useViewDateRange();

  // Real-time subscriptions
  useFinancialSubscriptions({
    user,
    authLoading,
    setUserProfile,
    setIncomeSources,
    setExpenseRules,
    setStoredTransactions,
    setAlerts,
    setIsLoading,
    setIsInitialized,
  });

  // Compute merged transactions: stored transactions + generated projections
  const transactions = useMemo(() => {
    if (!isInitialized) {
      return storedTransactions;
    }

    return mergeTransactionsWithProjections(
      storedTransactions,
      incomeSources,
      expenseRules,
      viewDateRange,
      user?.uid
    );
  }, [incomeSources, expenseRules, storedTransactions, viewDateRange, user?.uid, isInitialized]);

  // Computed values
  const dailyBalances = useDailyBalances(userProfile, transactions, viewDateRange);
  const billCoverage = useBillCoverage(userProfile, transactions);
  const upcomingBills = useUpcomingBills(billCoverage);

  // Actions
  const actions = useFinancialActions({
    user,
    userProfile,
    incomeSourcesRef,
    expenseRulesRef,
    setIsLoading,
    setUserProfile,
    setIncomeSources,
    setExpenseRules,
    setStoredTransactions,
    setAlerts,
  });

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

  const value: FinancialContextValue = {
    isLoading,
    isInitialized,
    userProfile,
    incomeSources,
    expenseRules,
    transactions,
    viewDateRange,
    setViewDateRange,
    dailyBalances,
    billCoverage,
    upcomingBills,
    alerts,
    ...actions,
  };

  return <FinancialContext.Provider value={value}>{children}</FinancialContext.Provider>;
};

export default FinancialContext;
