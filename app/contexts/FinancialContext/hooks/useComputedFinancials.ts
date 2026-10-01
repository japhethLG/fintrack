import { useMemo } from "react";
import { UserProfile, Transaction, DayBalance, BillCoverageReport, UpcomingBill } from "@/lib/types";
import {
  BILL_COVERAGE_DAYS,
  calculateDailyBalances,
  getBillCoverageReport,
} from "@/lib/logic/balanceCalculator";
import { getTodayKey, parseDate } from "@/lib/utils/dateUtils";

/** Used when a profile written by an earlier version has no preferences map. */
const DEFAULT_WARNING_THRESHOLD = 500;

/**
 * Hook to compute daily balances from transactions.
 *
 * Anchored on the realized balance (`currentBalance`), so it needs no history: a user with a
 * balance and no transactions still sees that balance on every day (never "—"), and the numbers do
 * not depend on how far the view window has been scrolled.
 */
export function useDailyBalances(
  userProfile: UserProfile | null,
  transactions: Transaction[],
  viewDateRange: { start: string; end: string }
): Map<string, DayBalance> {
  return useMemo(() => {
    if (!userProfile) {
      return new Map<string, DayBalance>();
    }

    return calculateDailyBalances(
      userProfile.currentBalance,
      transactions,
      parseDate(viewDateRange.start),
      parseDate(viewDateRange.end),
      userProfile.preferences?.defaultWarningThreshold ?? DEFAULT_WARNING_THRESHOLD,
      getTodayKey()
    );
  }, [userProfile, transactions, viewDateRange]);
}

/**
 * Hook to compute bill coverage report (the next 14 days, today included)
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
      BILL_COVERAGE_DAYS,
      getTodayKey()
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
