import { useCallback, MutableRefObject } from "react";
import { User } from "firebase/auth";
import {
  UserProfile,
  IncomeSource,
  ExpenseRule,
  Transaction,
  IncomeSourceFormData,
  ExpenseRuleFormData,
  CompleteTransactionData,
} from "@/lib/types";
import {
  createIncomeSourceAction,
  editIncomeSourceAction,
  removeIncomeSourceAction,
  toggleIncomeSourceActiveAction,
  createExpenseRuleAction,
  editExpenseRuleAction,
  removeExpenseRuleAction,
  toggleExpenseRuleActiveAction,
} from "../actions/sourceActions";
import {
  addManualTransactionAction,
  markTransactionCompleteAction,
  markTransactionSkippedAction,
  markTransactionPartialAction,
  removeTransactionAction,
} from "../actions/transactionActions";
import { updateProfileAction, setCurrentBalanceAction } from "../actions/userActions";
import { markAlertReadAction, dismissAlertAction } from "../actions/alertActions";
import {
  getUserProfile,
  getIncomeSources,
  getExpenseRules,
  getTransactions,
  getAlerts,
} from "@/lib/firebase/firestore";

interface UseFinancialActionsParams {
  user: User | null;
  userProfile: UserProfile | null;
  incomeSourcesRef: MutableRefObject<IncomeSource[]>;
  expenseRulesRef: MutableRefObject<ExpenseRule[]>;
  setIsLoading: (loading: boolean) => void;
  setUserProfile: (profile: UserProfile | null) => void;
  setIncomeSources: (sources: IncomeSource[]) => void;
  setExpenseRules: (rules: ExpenseRule[]) => void;
  setStoredTransactions: (transactions: Transaction[]) => void;
  setAlerts: (alerts: any[]) => void;
}

/**
 * Hook that creates all action callbacks for the Financial Context
 * Centralizes user authentication checks and action delegation
 */
export function useFinancialActions({
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
}: UseFinancialActionsParams) {
  // ============================================================================
  // USER PROFILE ACTIONS
  // ============================================================================

  const updateProfile = useCallback(
    async (updates: Partial<UserProfile["preferences"]>) => {
      if (!user) return;
      await updateProfileAction(user.uid, userProfile, updates);
    },
    [user, userProfile]
  );

  const setCurrentBalance = useCallback(
    async (balance: number) => {
      if (!user) return;
      await setCurrentBalanceAction(user.uid, balance);
    },
    [user]
  );

  // ============================================================================
  // INCOME SOURCE ACTIONS
  // ============================================================================

  const createIncomeSource = useCallback(
    async (data: IncomeSourceFormData): Promise<IncomeSource> => {
      if (!user) throw new Error("User not authenticated");
      return createIncomeSourceAction(data, user.uid);
    },
    [user]
  );

  const editIncomeSource = useCallback(async (id: string, data: Partial<IncomeSourceFormData>) => {
    await editIncomeSourceAction(id, data);
  }, []);

  const removeIncomeSource = useCallback(async (id: string) => {
    await removeIncomeSourceAction(id);
  }, []);

  const toggleIncomeSourceActive = useCallback(async (id: string, isActive: boolean) => {
    await toggleIncomeSourceActiveAction(id, isActive);
  }, []);

  // ============================================================================
  // EXPENSE RULE ACTIONS
  // ============================================================================

  const createExpenseRule = useCallback(
    async (data: ExpenseRuleFormData): Promise<ExpenseRule> => {
      if (!user) throw new Error("User not authenticated");
      return createExpenseRuleAction(data, user.uid);
    },
    [user]
  );

  const editExpenseRule = useCallback(async (id: string, data: Partial<ExpenseRuleFormData>) => {
    await editExpenseRuleAction(id, data);
  }, []);

  const removeExpenseRule = useCallback(async (id: string) => {
    await removeExpenseRuleAction(id);
  }, []);

  const toggleExpenseRuleActive = useCallback(async (id: string, isActive: boolean) => {
    await toggleExpenseRuleActiveAction(id, isActive);
  }, []);

  // ============================================================================
  // TRANSACTION ACTIONS
  // ============================================================================

  const addManualTransaction = useCallback(
    async (
      transaction: Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">
    ): Promise<Transaction> => {
      if (!user) throw new Error("User not authenticated");
      return addManualTransactionAction(transaction, user.uid);
    },
    [user]
  );

  const markTransactionComplete = useCallback(
    async (id: string, data: CompleteTransactionData) => {
      if (!user) throw new Error("User not authenticated");
      await markTransactionCompleteAction(
        id,
        data,
        user.uid,
        incomeSourcesRef.current,
        expenseRulesRef.current
      );
    },
    [user, incomeSourcesRef, expenseRulesRef]
  );

  const markTransactionSkipped = useCallback(
    async (id: string, notes?: string) => {
      if (!user) {
        throw new Error("User not authenticated");
      }
      await markTransactionSkippedAction(
        id,
        notes,
        user.uid,
        incomeSourcesRef.current,
        expenseRulesRef.current
      );
    },
    [user, incomeSourcesRef, expenseRulesRef]
  );

  const markTransactionPartial = useCallback(
    async (id: string, partialAmount: number, notes?: string): Promise<Transaction> => {
      if (!user) {
        throw new Error("User not authenticated");
      }
      return markTransactionPartialAction(
        id,
        partialAmount,
        notes,
        user.uid,
        incomeSourcesRef.current,
        expenseRulesRef.current
      );
    },
    [user, incomeSourcesRef, expenseRulesRef]
  );

  const removeTransaction = useCallback(async (id: string) => {
    await removeTransactionAction(id);
  }, []);

  // ============================================================================
  // ALERT ACTIONS
  // ============================================================================

  const markAlertRead = useCallback(async (id: string) => {
    await markAlertReadAction(id);
  }, []);

  const dismissAlertById = useCallback(async (id: string) => {
    await dismissAlertAction(id);
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
  }, [user, setIsLoading, setUserProfile, setIncomeSources, setExpenseRules, setStoredTransactions, setAlerts]);

  return {
    // User actions
    updateProfile,
    setCurrentBalance,
    // Income source actions
    createIncomeSource,
    editIncomeSource,
    removeIncomeSource,
    toggleIncomeSourceActive,
    // Expense rule actions
    createExpenseRule,
    editExpenseRule,
    removeExpenseRule,
    toggleExpenseRuleActive,
    // Transaction actions
    addManualTransaction,
    markTransactionComplete,
    markTransactionSkipped,
    markTransactionPartial,
    removeTransaction,
    // Alert actions
    markAlertRead,
    dismissAlertById,
    // Utilities
    refreshData,
  };
}

