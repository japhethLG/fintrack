import { useMemo } from "react";
import { UserProfile, Transaction, DayBalance, BillCoverageReport, UpcomingBill } from "@/lib/types";
import { calculateDailyBalances, getBillCoverageReport } from "@/lib/logic/balanceCalculator";

/**
 * Hook to compute daily balances from transactions
 */
export function useDailyBalances(
  userProfile: UserProfile | null,
  transactions: Transaction[],
  viewDateRange: { start: string; end: string }
): Map<string, DayBalance> {
  return useMemo(() => {
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
}

/**
 * Hook to compute bill coverage report
 */
export function useBillCoverage(
  userProfile: UserProfile | null,
  transactions: Transaction[]
): BillCoverageReport | null {
  return useMemo(() => {
    if (!userProfile || transactions.length === 0) {
      return null;
    }

    return getBillCoverageReport(
      userProfile.currentBalance,
      transactions,
      14 // Next 14 days
    );
  }, [userProfile, transactions]);
}

/**
 * Hook to get upcoming bills from bill coverage
 */
export function useUpcomingBills(billCoverage: BillCoverageReport | null): UpcomingBill[] {
  return useMemo(() => {
    return billCoverage?.upcomingBills || [];
  }, [billCoverage]);
}

