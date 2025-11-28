"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
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
  subscribeToStoredTransactions,
  // Alerts
  getAlerts,
  markAlertAsRead,
  dismissAlert,
  subscribeToAlerts,
} from "@/lib/firebase/firestore";
import { generateProjections } from "@/lib/logic/projectionEngine";
import { calculateDailyBalances, getBillCoverageReport } from "@/lib/logic/balanceCalculator";

// ============================================================================
// CONTEXT INTERFACE
// ============================================================================

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

  // Transactions (merged: stored + computed projections)
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

  // View date range for projections
  viewDateRange: { start: string; end: string };
  setViewDateRange: (start: string, end: string) => void;

  // Computed data
  dailyBalances: Map<string, DayBalance>;
  billCoverage: BillCoverageReport | null;
  upcomingBills: UpcomingBill[];

  // Alerts
  alerts: Alert[];
  markAlertRead: (id: string) => Promise<void>;
  dismissAlertById: (id: string) => Promise<void>;

  // Actions
  refreshData: () => Promise<void>;
}

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
  const storedTransactionsRef = useRef<Transaction[]>([]);
  const expenseRulesRef = useRef<ExpenseRule[]>([]);
  const userProfileRef = useRef<UserProfile | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    storedTransactionsRef.current = storedTransactions;
  }, [storedTransactions]);

  useEffect(() => {
    expenseRulesRef.current = expenseRules;
  }, [expenseRules]);

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  // View date range for computing projections (calendar can adjust this)
  const [viewDateRange, setViewDateRangeState] = useState(() => {
    const today = new Date();
    // Default: 2 months back to 4 months forward
    const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
    };
  });

  // Set view date range (expands if needed, never shrinks)
  const setViewDateRange = useCallback((start: string, end: string) => {
    setViewDateRangeState((current) => {
      const newStart = start < current.start ? start : current.start;
      const newEnd = end > current.end ? end : current.end;

      // Only update if range actually changed
      if (newStart === current.start && newEnd === current.end) {
        return current;
      }

      return { start: newStart, end: newEnd };
    });
  }, []);

  // Subscribe to real-time updates when user is authenticated
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
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

    // Subscribe to stored transactions only (completed, skipped, partial, pending)
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
  }, [user, authLoading]);

  // ============================================================================
  // ON-THE-FLY PROJECTION COMPUTATION
  // ============================================================================

  // Compute merged transactions: stored transactions + generated projections
  const transactions = useMemo(() => {
    // Don't compute projections until initialized to avoid unnecessary work
    if (!isInitialized) {
      return storedTransactions;
    }

    // Generate projections for the view date range
    const activeIncomeSources = incomeSources.filter((s) => s.isActive);
    const activeExpenseRules = expenseRules.filter((r) => r.isActive);

    // Skip projection generation if no sources/rules
    if (activeIncomeSources.length === 0 && activeExpenseRules.length === 0) {
      return storedTransactions;
    }

    const projections = generateProjections(
      activeIncomeSources,
      activeExpenseRules,
      new Date(viewDateRange.start),
      new Date(viewDateRange.end)
    );

    // Create lookup map of stored transactions by key (sourceId + scheduledDate)
    // This allows us to match stored transactions with their projected counterparts
    const storedByKey = new Map<string, Transaction>();
    storedTransactions.forEach((t) => {
      if (t.sourceId) {
        const key = `${t.sourceId}-${t.scheduledDate}`;
        storedByKey.set(key, t);
      }
    });

    // Merge: stored transactions take precedence over projections
    const mergedTransactions: Transaction[] = projections.map((proj) => {
      const key = `${proj.sourceId}-${proj.scheduledDate}`;
      const stored = storedByKey.get(key);

      if (stored) {
        // Use stored transaction (completed, skipped, etc.) - remove from map
        storedByKey.delete(key);
        return stored;
      }

      // Return projection with deterministic ID
      return {
        ...proj,
        id: `proj_${key}`, // Deterministic ID for projections
        userId: user?.uid || "",
        createdAt: null as unknown as Transaction["createdAt"],
        updatedAt: null as unknown as Transaction["updatedAt"],
      } as Transaction;
    });

    // Add any manual transactions (no sourceId) and remaining stored transactions
    // that weren't matched (e.g., from sources that no longer exist or are inactive)
    storedTransactions.forEach((t) => {
      if (!t.sourceId) {
        // Manual transaction - always include
        mergedTransactions.push(t);
      } else {
        const key = `${t.sourceId}-${t.scheduledDate}`;
        if (storedByKey.has(key)) {
          // Stored transaction that didn't match any projection - include it
          mergedTransactions.push(t);
        }
      }
    });

    // Sort by scheduled date
    mergedTransactions.sort((a, b) => {
      const dateA = a.actualDate || a.scheduledDate;
      const dateB = b.actualDate || b.scheduledDate;
      return dateA.localeCompare(dateB);
    });

    return mergedTransactions;
  }, [incomeSources, expenseRules, storedTransactions, viewDateRange, user?.uid, isInitialized]);

  // Calculate daily balances whenever data changes
  const dailyBalances = useMemo(() => {
    if (!userProfile || transactions.length === 0) {
      return new Map<string, DayBalance>();
    }

    return calculateDailyBalances(
      userProfile.currentBalance,
      transactions,
      new Date(viewDateRange.start),
      new Date(viewDateRange.end),
      userProfile.preferences.defaultWarningThreshold
    );
  }, [userProfile, transactions, viewDateRange]);

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

  // ============================================================================
  // USER PROFILE ACTIONS
  // ============================================================================

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

  // ============================================================================
  // INCOME SOURCE ACTIONS
  // ============================================================================

  const createIncomeSource = useCallback(
    async (data: IncomeSourceFormData): Promise<IncomeSource> => {
      if (!user) throw new Error("User not authenticated");

      // Just create the source - projections are computed on-the-fly
      const source = await addIncomeSource(user.uid, {
        ...data,
        isActive: true,
      });

      return source;
    },
    [user]
  );

  const editIncomeSource = useCallback(
    async (id: string, data: Partial<IncomeSourceFormData>) => {
      // Just update the source - projections will recompute automatically
      await updateIncomeSource(id, data);
    },
    []
  );

  const removeIncomeSource = useCallback(async (id: string) => {
    // Just delete the source - projections will recompute automatically
    // Note: We don't delete stored transactions (completed/skipped) as they're historical
    await deleteIncomeSource(id);
  }, []);

  const toggleIncomeSourceActive = useCallback(
    async (id: string, isActive: boolean) => {
      // Just update - projections will recompute automatically
      await updateIncomeSource(id, { isActive });
    },
    []
  );

  // ============================================================================
  // EXPENSE RULE ACTIONS
  // ============================================================================

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

      // Just create the rule - projections are computed on-the-fly
      const rule = await addExpenseRule(user.uid, ruleData);

      return rule;
    },
    [user]
  );

  const editExpenseRule = useCallback(
    async (id: string, data: Partial<ExpenseRuleFormData>) => {
      // Just update the rule - projections will recompute automatically
      await updateExpenseRule(id, data);
    },
    []
  );

  const removeExpenseRule = useCallback(async (id: string) => {
    // Just delete the rule - projections will recompute automatically
    // Note: We don't delete stored transactions (completed/skipped) as they're historical
    await deleteExpenseRule(id);
  }, []);

  const toggleExpenseRuleActive = useCallback(
    async (id: string, isActive: boolean) => {
      // Just update - projections will recompute automatically
      await updateExpenseRule(id, { isActive });
    },
    []
  );

  // ============================================================================
  // TRANSACTION ACTIONS
  // ============================================================================

  const addManualTransaction = useCallback(
    async (
      transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
    ): Promise<Transaction> => {
      if (!user) throw new Error("User not authenticated");
      return addTransaction(user.uid, transaction);
    },
    [user]
  );

  const markTransactionComplete = useCallback(
    async (id: string, data: CompleteTransactionData) => {
      if (!user) throw new Error("User not authenticated");

      // Check if this is a projected transaction (needs to be stored first)
      if (id.startsWith("proj_")) {
        // Parse the projection ID to get sourceId and scheduledDate
        // Format: proj_${sourceId}-${scheduledDate}
        const keyPart = id.substring(5); // Remove "proj_" prefix
        const lastDashIndex = keyPart.lastIndexOf("-");
        if (lastDashIndex === -1) {
          throw new Error("Invalid projection ID format");
        }
        const sourceId = keyPart.substring(0, lastDashIndex);
        const scheduledDate = keyPart.substring(lastDashIndex + 1);

        // Find the source to get transaction details
        const incomeSource = incomeSources.find((s) => s.id === sourceId);
        const expenseRule = expenseRulesRef.current.find((r) => r.id === sourceId);
        const source = incomeSource || expenseRule;

        if (!source) {
          throw new Error("Source not found for projection");
        }

        const isIncome = !!incomeSource;
        const sourceType = isIncome ? "income_source" : "expense_rule";

        // Create the stored transaction as completed
        await addTransaction(user.uid, {
          name: source.name,
          type: isIncome ? "income" : "expense",
          category: source.category,
          sourceType,
          sourceId: source.id,
          projectedAmount: source.amount,
          actualAmount: data.actualAmount,
          scheduledDate,
          actualDate: data.actualDate || scheduledDate,
          status: "completed",
          notes: data.notes,
        });

        // Update user balance
        const delta = isIncome ? data.actualAmount : -data.actualAmount;
        await updateUserBalance(user.uid, (userProfileRef.current?.currentBalance || 0) + delta);

        // Update source tracking if applicable (loan/installment)
        if (!isIncome && expenseRule) {
          if (expenseRule.loanConfig) {
            await updateExpenseRule(source.id, {
              loanConfig: {
                ...expenseRule.loanConfig,
                paymentsMade: expenseRule.loanConfig.paymentsMade + 1,
              },
            });
          } else if (expenseRule.installmentConfig) {
            await updateExpenseRule(source.id, {
              installmentConfig: {
                ...expenseRule.installmentConfig,
                installmentsPaid: expenseRule.installmentConfig.installmentsPaid + 1,
              },
            });
          }
        }
      } else {
        // This is a stored transaction - use normal completion flow
        await completeTransaction(id, data.actualAmount, data.actualDate, data.notes);
      }
    },
    [user, incomeSources]
  );

  const markTransactionSkipped = useCallback(
    async (id: string, notes?: string) => {
      if (!user) throw new Error("User not authenticated");

      // Check if this is a projected transaction
      if (id.startsWith("proj_")) {
        // Parse the projection ID to get sourceId and scheduledDate
        const keyPart = id.substring(5);
        const lastDashIndex = keyPart.lastIndexOf("-");
        if (lastDashIndex === -1) {
          throw new Error("Invalid projection ID format");
        }
        const sourceId = keyPart.substring(0, lastDashIndex);
        const scheduledDate = keyPart.substring(lastDashIndex + 1);

        // Find the source
        const incomeSource = incomeSources.find((s) => s.id === sourceId);
        const expenseRule = expenseRulesRef.current.find((r) => r.id === sourceId);
        const source = incomeSource || expenseRule;

        if (!source) {
          throw new Error("Source not found for projection");
        }

        const isIncome = !!incomeSource;

        // Create stored transaction as skipped
        await addTransaction(user.uid, {
          name: source.name,
          type: isIncome ? "income" : "expense",
          category: source.category,
          sourceType: isIncome ? "income_source" : "expense_rule",
          sourceId: source.id,
          projectedAmount: source.amount,
          scheduledDate,
          status: "skipped",
          notes,
        });
      } else {
        await skipTransaction(id, notes);
      }
    },
    [user, incomeSources]
  );

  const markTransactionPartial = useCallback(
    async (id: string, partialAmount: number, notes?: string): Promise<Transaction> => {
      if (!user) throw new Error("User not authenticated");

      // Check if this is a projected transaction
      if (id.startsWith("proj_")) {
        // Parse the projection ID
        const keyPart = id.substring(5);
        const lastDashIndex = keyPart.lastIndexOf("-");
        if (lastDashIndex === -1) {
          throw new Error("Invalid projection ID format");
        }
        const sourceId = keyPart.substring(0, lastDashIndex);
        const scheduledDate = keyPart.substring(lastDashIndex + 1);

        // Find the source
        const incomeSource = incomeSources.find((s) => s.id === sourceId);
        const expenseRule = expenseRulesRef.current.find((r) => r.id === sourceId);
        const source = incomeSource || expenseRule;

        if (!source) {
          throw new Error("Source not found for projection");
        }

        const isIncome = !!incomeSource;
        const sourceType = isIncome ? "income_source" : "expense_rule";

        // Create stored transaction as partial
        const partialTx = await addTransaction(user.uid, {
          name: source.name,
          type: isIncome ? "income" : "expense",
          category: source.category,
          sourceType,
          sourceId: source.id,
          projectedAmount: source.amount,
          actualAmount: partialAmount,
          scheduledDate,
          status: "partial",
          notes,
        });

        // Update user balance
        const delta = isIncome ? partialAmount : -partialAmount;
        await updateUserBalance(user.uid, (userProfileRef.current?.currentBalance || 0) + delta);

        // Create remainder transaction
        const remainder = source.amount - partialAmount;
        const nextWeek = new Date(scheduledDate);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split("T")[0];

        await addTransaction(user.uid, {
          name: `${source.name} (Remainder)`,
          type: isIncome ? "income" : "expense",
          category: source.category,
          sourceType,
          sourceId: source.id,
          projectedAmount: remainder,
          scheduledDate: nextWeekStr,
          status: "pending",
        });

        return partialTx;
      } else {
        return partialPayTransaction(id, partialAmount, notes);
      }
    },
    [user, incomeSources]
  );

  const removeTransaction = useCallback(async (id: string) => {
    // Can only delete stored transactions, not projections
    if (!id.startsWith("proj_")) {
      await deleteTransaction(id);
    }
  }, []);

  // ============================================================================
  // ALERT ACTIONS
  // ============================================================================

  const markAlertRead = useCallback(async (id: string) => {
    await markAlertAsRead(id);
  }, []);

  const dismissAlertById = useCallback(async (id: string) => {
    await dismissAlert(id);
  }, []);

  // ============================================================================
  // REFRESH DATA
  // ============================================================================

  const refreshData = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);

    try {
      const [profile, sources, rules, txns, alertsList] = await Promise.all([
        getUserProfile(user.uid),
        getIncomeSources(user.uid),
        getExpenseRules(user.uid),
        getTransactions(user.uid, {
          status: ["completed", "skipped", "partial", "pending"],
        }),
        getAlerts(user.uid),
      ]);

      setUserProfile(profile);
      setIncomeSources(sources);
      setExpenseRules(rules);
      setStoredTransactions(txns);
      setAlerts(alertsList);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // ============================================================================
  // CONTEXT VALUE
  // ============================================================================

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
    viewDateRange,
    setViewDateRange,
    dailyBalances,
    billCoverage,
    upcomingBills,
    alerts,
    markAlertRead,
    dismissAlertById,
    refreshData,
  };

  return <FinancialContext.Provider value={value}>{children}</FinancialContext.Provider>;
};

export default FinancialContext;
