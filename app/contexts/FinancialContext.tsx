"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import {
  UserProfile,
  IncomeSource,
  ExpenseRule,
  Transaction,
  DayBalance,
  BillCoverageReport,
  UpcomingBill,
  Alert,
  BalanceStatus,
  IncomeSourceFormData,
  ExpenseRuleFormData,
  CompleteTransactionData,
} from "@/lib/types";
import {
  // User
  getUserProfile,
  updateUserProfile,
  updateUserBalance,
  subscribeToUserProfile,
  // Income Sources
  addIncomeSource,
  getIncomeSources,
  updateIncomeSource,
  deleteIncomeSource,
  subscribeToIncomeSources,
  // Expense Rules
  addExpenseRule,
  getExpenseRules,
  updateExpenseRule,
  deleteExpenseRule,
  subscribeToExpenseRules,
  // Transactions
  addTransaction,
  getTransactions,
  completeTransaction,
  skipTransaction,
  partialPayTransaction,
  deleteTransaction,
  deleteTransactionsBySource,
  subscribeToTransactions,
  addTransactionsBatch,
  // Alerts
  getAlerts,
  createAlert,
  markAlertAsRead,
  dismissAlert,
  subscribeToAlerts,
} from "@/lib/firebase/firestore";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { calculateDailyBalances, getBillCoverageReport } from "@/lib/logic/balanceCalculator";

interface FinancialContextValue {
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // User data
  userProfile: UserProfile | null;
  updateProfile: (updates: Partial<UserProfile["preferences"]>) => Promise<void>;
  setCurrentBalance: (balance: number) => Promise<void>;

  // Income Sources
  incomeSources: IncomeSource[];
  createIncomeSource: (data: IncomeSourceFormData) => Promise<IncomeSource>;
  editIncomeSource: (id: string, data: Partial<IncomeSourceFormData>) => Promise<void>;
  removeIncomeSource: (id: string) => Promise<void>;
  toggleIncomeSourceActive: (id: string, isActive: boolean) => Promise<void>;

  // Expense Rules
  expenseRules: ExpenseRule[];
  createExpenseRule: (data: ExpenseRuleFormData) => Promise<ExpenseRule>;
  editExpenseRule: (id: string, data: Partial<ExpenseRuleFormData>) => Promise<void>;
  removeExpenseRule: (id: string) => Promise<void>;
  toggleExpenseRuleActive: (id: string, isActive: boolean) => Promise<void>;

  // Transactions
  transactions: Transaction[];
  addManualTransaction: (
    transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
  ) => Promise<Transaction>;
  markTransactionComplete: (id: string, data: CompleteTransactionData) => Promise<void>;
  markTransactionSkipped: (id: string, notes?: string) => Promise<void>;
  markTransactionPartial: (
    id: string,
    partialAmount: number,
    notes?: string
  ) => Promise<Transaction>;
  removeTransaction: (id: string) => Promise<void>;

  // Computed data
  dailyBalances: Map<string, DayBalance>;
  billCoverage: BillCoverageReport | null;
  upcomingBills: UpcomingBill[];

  // Alerts
  alerts: Alert[];
  markAlertRead: (id: string) => Promise<void>;
  dismissAlertById: (id: string) => Promise<void>;

  // Actions
  regenerateProjections: () => Promise<void>;
  refreshData: () => Promise<void>;
}

const FinancialContext = createContext<FinancialContextValue | null>(null);

export const useFinancial = (): FinancialContextValue => {
  const context = useContext(FinancialContext);
  if (!context) {
    throw new Error("useFinancial must be used within a FinancialProvider");
  }
  return context;
};

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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Date range for projections (current month + 3 months)
  const dateRange = useMemo(() => {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    };
  }, []);

  // Subscribe to real-time updates when user is authenticated
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setUserProfile(null);
      setIncomeSources([]);
      setExpenseRules([]);
      setTransactions([]);
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

    // Subscribe to transactions
    const unsubTransactions = subscribeToTransactions(
      user.uid,
      (txns) => {
        setTransactions(txns);
      },
      { startDate: dateRange.start, endDate: dateRange.end }
    );
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
  }, [user, authLoading, dateRange]);

  // Calculate daily balances whenever data changes
  const dailyBalances = useMemo(() => {
    if (!userProfile || transactions.length === 0) {
      return new Map<string, DayBalance>();
    }

    return calculateDailyBalances(
      userProfile.currentBalance,
      transactions,
      new Date(dateRange.start),
      new Date(dateRange.end),
      userProfile.preferences.defaultWarningThreshold
    );
  }, [userProfile, transactions, dateRange]);

  // Calculate bill coverage report
  const billCoverage = useMemo(() => {
    if (!userProfile || transactions.length === 0) {
      return null;
    }

    return getBillCoverageReport(
      userProfile.currentBalance,
      transactions,
      14 // Next 14 days
    );
  }, [userProfile, transactions]);

  // Get upcoming bills
  const upcomingBills = useMemo(() => {
    return billCoverage?.upcomingBills || [];
  }, [billCoverage]);

  // User profile actions
  const updateProfile = useCallback(
    async (updates: Partial<UserProfile["preferences"]>) => {
      if (!user) return;
      await updateUserProfile(user.uid, {
        preferences: { ...userProfile?.preferences, ...updates } as UserProfile["preferences"],
      });
    },
    [user, userProfile]
  );

  const setCurrentBalance = useCallback(
    async (balance: number) => {
      if (!user) return;
      await updateUserBalance(user.uid, balance);
    },
    [user]
  );

  // Income source actions
  const createIncomeSource = useCallback(
    async (data: IncomeSourceFormData): Promise<IncomeSource> => {
      if (!user) throw new Error("User not authenticated");

      const source = await addIncomeSource(user.uid, {
        ...data,
        isActive: true,
      });

      // Generate projections for this source
      const newProjections = generateProjections(
        [source],
        [],
        new Date(dateRange.start),
        new Date(dateRange.end)
      );

      if (newProjections.length > 0) {
        await addTransactionsBatch(user.uid, newProjections);
      }

      return source;
    },
    [user, dateRange]
  );

  const editIncomeSource = useCallback(
    async (id: string, data: Partial<IncomeSourceFormData>) => {
      await updateIncomeSource(id, data);

      // Regenerate projections if schedule changed
      if (data.frequency || data.scheduleConfig || data.startDate || data.endDate || data.amount) {
        // Delete existing projected transactions and regenerate
        await deleteTransactionsBySource("income_source", id, ["projected"]);

        const source = incomeSources.find((s) => s.id === id);
        if (source && user) {
          const updatedSource = { ...source, ...data };
          const newProjections = generateProjections(
            [updatedSource as IncomeSource],
            [],
            new Date(dateRange.start),
            new Date(dateRange.end)
          );
          if (newProjections.length > 0) {
            await addTransactionsBatch(user.uid, newProjections);
          }
        }
      }
    },
    [user, incomeSources, dateRange]
  );

  const removeIncomeSource = useCallback(async (id: string) => {
    await deleteTransactionsBySource("income_source", id, ["projected", "pending"]);
    await deleteIncomeSource(id);
  }, []);

  const toggleIncomeSourceActive = useCallback(
    async (id: string, isActive: boolean) => {
      await updateIncomeSource(id, { isActive });

      if (!isActive) {
        // Remove future projections
        await deleteTransactionsBySource("income_source", id, ["projected"]);
      } else if (user) {
        // Regenerate projections
        const source = incomeSources.find((s) => s.id === id);
        if (source) {
          const newProjections = generateProjections(
            [{ ...source, isActive: true }],
            [],
            new Date(dateRange.start),
            new Date(dateRange.end)
          );
          if (newProjections.length > 0) {
            await addTransactionsBatch(user.uid, newProjections);
          }
        }
      }
    },
    [user, incomeSources, dateRange]
  );

  // Expense rule actions
  const createExpenseRule = useCallback(
    async (data: ExpenseRuleFormData): Promise<ExpenseRule> => {
      if (!user) throw new Error("User not authenticated");

      // Initialize tracking fields
      const ruleData: Omit<ExpenseRule, "id" | "userId" | "createdAt" | "updatedAt"> = {
        ...data,
        isActive: true,
        loanConfig: data.loanConfig ? { ...data.loanConfig, paymentsMade: 0 } : undefined,
        installmentConfig: data.installmentConfig
          ? { ...data.installmentConfig, installmentsPaid: 0 }
          : undefined,
      };

      const rule = await addExpenseRule(user.uid, ruleData);

      // Generate projections for this rule
      const newProjections = generateProjections(
        [],
        [rule],
        new Date(dateRange.start),
        new Date(dateRange.end)
      );

      if (newProjections.length > 0) {
        await addTransactionsBatch(user.uid, newProjections);
      }

      return rule;
    },
    [user, dateRange]
  );

  const editExpenseRule = useCallback(
    async (id: string, data: Partial<ExpenseRuleFormData>) => {
      await updateExpenseRule(id, data);

      // Regenerate projections if schedule changed
      if (
        data.frequency ||
        data.scheduleConfig ||
        data.startDate ||
        data.endDate ||
        data.amount ||
        data.loanConfig ||
        data.creditConfig ||
        data.installmentConfig
      ) {
        await deleteTransactionsBySource("expense_rule", id, ["projected"]);

        const rule = expenseRules.find((r) => r.id === id);
        if (rule && user) {
          const updatedRule = { ...rule, ...data };
          const newProjections = generateProjections(
            [],
            [updatedRule as ExpenseRule],
            new Date(dateRange.start),
            new Date(dateRange.end)
          );
          if (newProjections.length > 0) {
            await addTransactionsBatch(user.uid, newProjections);
          }
        }
      }
    },
    [user, expenseRules, dateRange]
  );

  const removeExpenseRule = useCallback(async (id: string) => {
    await deleteTransactionsBySource("expense_rule", id, ["projected", "pending"]);
    await deleteExpenseRule(id);
  }, []);

  const toggleExpenseRuleActive = useCallback(
    async (id: string, isActive: boolean) => {
      await updateExpenseRule(id, { isActive });

      if (!isActive) {
        await deleteTransactionsBySource("expense_rule", id, ["projected"]);
      } else if (user) {
        const rule = expenseRules.find((r) => r.id === id);
        if (rule) {
          const newProjections = generateProjections(
            [],
            [{ ...rule, isActive: true }],
            new Date(dateRange.start),
            new Date(dateRange.end)
          );
          if (newProjections.length > 0) {
            await addTransactionsBatch(user.uid, newProjections);
          }
        }
      }
    },
    [user, expenseRules, dateRange]
  );

  // Transaction actions
  const addManualTransaction = useCallback(
    async (
      transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
    ): Promise<Transaction> => {
      if (!user) throw new Error("User not authenticated");
      return addTransaction(user.uid, transaction);
    },
    [user]
  );

  const markTransactionComplete = useCallback(async (id: string, data: CompleteTransactionData) => {
    await completeTransaction(id, data.actualAmount, data.actualDate, data.notes);
  }, []);

  const markTransactionSkipped = useCallback(async (id: string, notes?: string) => {
    await skipTransaction(id, notes);
  }, []);

  const markTransactionPartial = useCallback(
    async (id: string, partialAmount: number, notes?: string): Promise<Transaction> => {
      return partialPayTransaction(id, partialAmount, notes);
    },
    []
  );

  const removeTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id);
  }, []);

  // Alert actions
  const markAlertRead = useCallback(async (id: string) => {
    await markAlertAsRead(id);
  }, []);

  const dismissAlertById = useCallback(async (id: string) => {
    await dismissAlert(id);
  }, []);

  // Regenerate all projections
  const regenerateProjections = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);

    try {
      // Delete all projected transactions
      const projectedTransactions = transactions.filter((t) => t.status === "projected");
      for (const t of projectedTransactions) {
        await deleteTransaction(t.id);
      }

      // Generate new projections
      const activeIncomeSources = incomeSources.filter((s) => s.isActive);
      const activeExpenseRules = expenseRules.filter((r) => r.isActive);

      const newProjections = generateProjections(
        activeIncomeSources,
        activeExpenseRules,
        new Date(dateRange.start),
        new Date(dateRange.end)
      );

      if (newProjections.length > 0) {
        await addTransactionsBatch(user.uid, newProjections);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, transactions, incomeSources, expenseRules, dateRange]);

  // Refresh all data
  const refreshData = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);

    try {
      const [profile, sources, rules, txns, alertsList] = await Promise.all([
        getUserProfile(user.uid),
        getIncomeSources(user.uid),
        getExpenseRules(user.uid),
        getTransactions(user.uid, {
          startDate: dateRange.start,
          endDate: dateRange.end,
        }),
        getAlerts(user.uid),
      ]);

      setUserProfile(profile);
      setIncomeSources(sources);
      setExpenseRules(rules);
      setTransactions(txns);
      setAlerts(alertsList);
    } finally {
      setIsLoading(false);
    }
  }, [user, dateRange]);

  const value: FinancialContextValue = {
    isLoading,
    isInitialized,
    userProfile,
    updateProfile,
    setCurrentBalance,
    incomeSources,
    createIncomeSource,
    editIncomeSource,
    removeIncomeSource,
    toggleIncomeSourceActive,
    expenseRules,
    createExpenseRule,
    editExpenseRule,
    removeExpenseRule,
    toggleExpenseRuleActive,
    transactions,
    addManualTransaction,
    markTransactionComplete,
    markTransactionSkipped,
    markTransactionPartial,
    removeTransaction,
    dailyBalances,
    billCoverage,
    upcomingBills,
    alerts,
    markAlertRead,
    dismissAlertById,
    regenerateProjections,
    refreshData,
  };

  return <FinancialContext.Provider value={value}>{children}</FinancialContext.Provider>;
};

export default FinancialContext;
