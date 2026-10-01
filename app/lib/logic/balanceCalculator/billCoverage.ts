/**
 * Bill coverage and shortfall analysis
 *
 * The window is EXACTLY `daysAhead` calendar days: today .. today + daysAhead - 1 ("Next 14 days of
 * bills", SPECIFICATION.md). Bills are walked in the order of openItems.ts (D5):
 *
 *   1. overdue expenses first: they are owed now (income that is overdue is NOT credited);
 *   2. then the window, day by day, income before expenses within a day.
 *
 * Each bill reports its OWN shortfall: the part of that bill the money on hand cannot pay. An
 * earlier uncovered bill does not inflate a later one ("Need $100" after a 200 shortfall stays
 * $100); the running balance still goes on down, so `projectedBalance` is the true end balance.
 */

import { Transaction, BillCoverageReport, UpcomingBill } from "@/lib/types";
import { dayNumberOfDate, getTodayKey, parseDate } from "@/lib/utils/dateUtils";
import { cleanMoney } from "./ledgerMath";
import { amountOf, collectOpenItems, rowDate } from "./openItems";

/** The spec's window: "Next 14 days of bills". */
export const BILL_COVERAGE_DAYS = 14;

/**
 * Analyze if current balance can cover upcoming bills
 * @param currentBalance - Realized account balance
 * @param transactions - All transactions
 * @param daysAhead - Window length in days, today inclusive (default: 14)
 * @param today - Local day key (default: today)
 * @returns Report showing bill coverage and potential shortfalls
 */
export const getBillCoverageReport = (
  currentBalance: number,
  transactions: readonly Transaction[],
  daysAhead: number = BILL_COVERAGE_DAYS,
  today: string = getTodayKey()
): BillCoverageReport => {
  const open = collectOpenItems(transactions, today);
  const todayNumber = dayNumberOfDate(parseDate(today));
  const lastDay = todayNumber + daysAhead - 1;

  const inWindow = open.upcoming.filter(
    (t) => dayNumberOfDate(parseDate(rowDate(t))) <= lastDay
  );
  // Overdue expenses are owed now; overdue income has not arrived and is not credited.
  const overdueBills = open.overdue.filter((t) => t.type !== "income");
  const walk = [...overdueBills, ...inWindow];

  const upcomingBills: UpcomingBill[] = [];
  const billsAtRisk: UpcomingBill[] = [];
  let runningBalance = currentBalance;
  let totalBillsAmount = 0;

  walk.forEach((t) => {
    const amount = amountOf(t);

    if (t.type === "income") {
      runningBalance += amount;
      return;
    }

    totalBillsAmount += amount;
    const available = Math.max(runningBalance, 0);
    const shortfallAmount = Math.max(cleanMoney(amount - available), 0);
    const canCover = shortfallAmount === 0;

    const bill: UpcomingBill = {
      transaction: t,
      daysUntilDue: dayNumberOfDate(parseDate(rowDate(t))) - todayNumber,
      canCover,
      shortfall: canCover ? undefined : shortfallAmount,
    };
    upcomingBills.push(bill);
    if (!canCover) billsAtRisk.push(bill);

    runningBalance -= amount;
  });

  const firstAtRisk = billsAtRisk[0];
  const firstShortfall = firstAtRisk
    ? {
        date: rowDate(firstAtRisk.transaction),
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
