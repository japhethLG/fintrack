import { useMemo } from "react";
import { UserProfile, Transaction, DayBalance, BillCoverageReport, UpcomingBill } from "@/lib/types";
import { calculateDailyBalances, getBillCoverageReport } from "@/lib/logic/balanceCalculator";
import { parseDate } from "@/lib/utils/dateUtils";

/** Used when a profile written by an earlier version has no preferences map. */
const DEFAULT_WARNING_THRESHOLD = 500;

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
      parseDate(viewDateRange.start),
      parseDate(viewDateRange.end),
      userProfile.preferences?.defaultWarningThreshold ?? DEFAULT_WARNING_THRESHOLD
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

