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
  OccurrenceOverride,
} from "@/lib/types";

/**
 * Financial Context Value Interface
 * Defines all state and actions exposed by the FinancialContext
 */
export interface FinancialContextValue {
  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // User data
  userProfile: UserProfile | null;
  updateProfile: (updates: Partial<UserProfile["preferences"]>) => Promise<void>;
  setCurrentBalance: (balance: number) => Promise<void>;
  updateProfilePicture: (profilePictureUrl: string) => Promise<void>;

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
  updateManualTransaction: (
    id: string,
    updates: Partial<Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">>
  ) => Promise<void>;
  deleteManualTransaction: (id: string) => Promise<void>;
  markTransactionComplete: (id: string, data: CompleteTransactionData) => Promise<void>;
  markTransactionSkipped: (id: string, notes?: string) => Promise<void>;
  rescheduleTransaction: (id: string, newDate: string) => Promise<void>;
  removeTransaction: (id: string) => Promise<void>;
  revertTransactionToProjected: (id: string) => Promise<void>;
  setOccurrenceOverride: (
    sourceId: string,
    occurrenceId: string,
    override: OccurrenceOverride,
    isIncome: boolean
  ) => Promise<void>;
  removeOccurrenceOverride: (
    sourceId: string,
    occurrenceId: string,
    isIncome: boolean
  ) => Promise<void>;

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
