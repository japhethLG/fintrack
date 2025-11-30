/**
 * Bill coverage and shortfall analysis
 */

import { Transaction, BillCoverageReport, UpcomingBill } from "@/lib/types";
import { formatDate, parseDate, addDays } from "@/lib/utils/dateUtils";

/**
 * Analyze if current balance can cover upcoming bills
 * @param currentBalance - Current account balance
 * @param transactions - All transactions
 * @param daysAhead - Number of days to look ahead (default: 14)
 * @returns Report showing bill coverage and potential shortfalls
 */
export const getBillCoverageReport = (
  currentBalance: number,
  transactions: Transaction[],
  daysAhead: number = 14
): BillCoverageReport => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = addDays(today, daysAhead);
  const todayStr = formatDate(today);
  const endDateStr = formatDate(endDate);

  // Filter transactions in the date range (exclude completed and skipped)
  const upcomingTransactions = transactions.filter((t) => {
    const date = t.actualDate || t.scheduledDate;
    return (
      date >= todayStr && date <= endDateStr && t.status !== "skipped" && t.status !== "completed"
    );
  });

  // Sort by date
  upcomingTransactions.sort((a, b) => {
    const dateA = a.actualDate || a.scheduledDate;
    const dateB = b.actualDate || b.scheduledDate;
    return dateA.localeCompare(dateB);
  });

  // Calculate coverage for each bill
  const upcomingBills: UpcomingBill[] = [];
  const billsAtRisk: UpcomingBill[] = [];
  let runningBalance = currentBalance;
  let totalBillsAmount = 0;

  upcomingTransactions.forEach((t) => {
    const amount =
      t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

    if (t.type === "income") {
      runningBalance += amount;
    } else {
      totalBillsAmount += amount;
      const balanceAfterBill = runningBalance - amount;
      const canCover = balanceAfterBill >= 0;
      const shortfall = canCover ? undefined : Math.abs(balanceAfterBill);

      const txDate = parseDate(t.scheduledDate);
      const daysUntilDue = Math.ceil((txDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      const billInfo: UpcomingBill = {
        transaction: t,
        daysUntilDue,
        canCover,
        shortfall,
      };

      upcomingBills.push(billInfo);

      if (!canCover) {
        billsAtRisk.push(billInfo);
      }

      runningBalance = balanceAfterBill;
    }
  });

  const firstAtRisk = billsAtRisk[0];
  const firstShortfall = firstAtRisk
    ? {
        date: firstAtRisk.transaction.scheduledDate,
        amount: firstAtRisk.shortfall || 0,
        billName: firstAtRisk.transaction.name,
      }
    : undefined;

  return {
    currentBalance,
    upcomingBills,
    totalUpcoming: totalBillsAmount,
    projectedBalance: runningBalance,
    canCoverAll: billsAtRisk.length === 0,
    firstShortfall,
  };
};
