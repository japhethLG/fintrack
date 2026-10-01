/**
 * Daily balance calculation logic
 *
 * ANCHORED ON THE REALIZED BALANCE (decision D5, see openItems.ts). The series is a function of the
 * realized balance `B`, the rows and `today` only. It never depends on which window was asked for,
 * so scrolling the calendar cannot change a number.
 *
 *   completed row  : already inside B. Realized history is "B minus everything completed after that
 *                    day". A completed row dated after today has already hit the account (it was
 *                    paid early): it stays LISTED and totalled on its own day, but its money moves
 *                    on today, so today's closing is still the realized balance.
 *   upcoming row   : projected, dated today or later: applied on its own day (income first).
 *   overdue row    : projected, dated before today. Listed (flagged) on its own day but it does NOT
 *                    move the realized history and is not in that day's totals. Its EXPENSES are
 *                    owed now, so they are deducted on today (`overdueOwed`); overdue income has
 *                    not arrived and is not credited.
 *
 * Every day satisfies: closing = opening + movedIncome - movedExpenses - (overdueOwed on today).
 * `totalIncome` / `totalExpenses` are what is LISTED and totalled on the day (a row on its own date);
 * `movedIncome` / `movedExpenses` are what actually MOVED the balance that day. They differ only for a
 * completed row dated after today (paid ahead of its date): listed on its own day, moved on today. The
 * day panel prints the moved figures so its totals agree with its opening-to-closing change, and shows
 * the paid-ahead rows (`paidAhead`, today only) where the money really moved (MANUAL-M10).
 *   skipped row    : nothing.
 *
 * Hence: today's OPENING balance is B (less anything completed today) and, when nothing is due or
 * overdue, today's CLOSING balance is B: the same number Dashboard and Settings print. Days after
 * today project forward from B - overdue owed + the upcoming rows.
 */

import { Transaction, DayBalance } from "@/lib/types";
import { dateFromDayNumber, dayNumberOfDate, formatDate, getTodayKey } from "@/lib/utils/dateUtils";
import { cleanMoney } from "./ledgerMath";
import { getBalanceStatus } from "./utils";
import { amountOf, collectOpenItems, isOverdue, rowDate } from "./openItems";

/**
 * Calculate daily balances over a date range
 * @param currentBalance - Realized balance (initial balance + every completed row)
 * @param transactions - All rows known to the app (any window; completed history before the range
 *        is accounted for through the realized balance)
 * @param startDate - Period start date
 * @param endDate - Period end date
 * @param warningThreshold - Balance threshold for warnings (default: 500)
 * @param today - Local day key the realized balance describes (default: today)
 * @returns Map of date strings to DayBalance objects
 */
export const calculateDailyBalances = (
  currentBalance: number,
  transactions: readonly Transaction[],
  startDate: Date,
  endDate: Date,
  warningThreshold: number = 500,
  today: string = getTodayKey()
): Map<string, DayBalance> => {
  const balances = new Map<string, DayBalance>();

  const overdueOwed = collectOpenItems(transactions, today).overdueOutflow;
  const startKey = formatDate(startDate);

  // What each day DISPLAYS (rows keyed by their own day, skipped rows listed but never counted) and
  // where each row MOVES the balance (completed flows and open flows, keyed by effective day).
  const rowsByDay = new Map<string, Transaction[]>();
  const completedFlowByDay = new Map<string, number>();
  const openFlowByDay = new Map<string, number>();
  // The same movements split by direction, and the rows paid ahead of their date (for the day panel).
  const movedIncomeByDay = new Map<string, number>();
  const movedExpensesByDay = new Map<string, number>();
  const paidAhead: Transaction[] = [];
  const addTo = (map: Map<string, number>, day: string, amount: number) =>
    map.set(day, (map.get(day) ?? 0) + amount);

  for (const t of transactions) {
    const own = rowDate(t);
    // Every row is LISTED and totalled on its own day (a chip never hops away from its date).
    const list = rowsByDay.get(own);
    if (list) list.push(t);
    else rowsByDay.set(own, [t]);

    if (t.status === "skipped") continue;
    const amount = amountOf(t);
    const signed = t.type === "income" ? amount : -amount;

    if (t.status === "completed") {
      // A COMPLETED row has already happened: its money moved on its own day, or TODAY when it is
      // dated later (paid ahead of its due date), which is what the realized balance already says.
      const moved = own > today ? today : own;
      completedFlowByDay.set(moved, (completedFlowByDay.get(moved) ?? 0) + signed);
      addTo(t.type === "income" ? movedIncomeByDay : movedExpensesByDay, moved, amount);
      if (own > today) paidAhead.push(t);
    } else if (t.status === "projected" && own >= today) {
      openFlowByDay.set(own, (openFlowByDay.get(own) ?? 0) + signed);
      addTo(t.type === "income" ? movedIncomeByDay : movedExpensesByDay, own, amount);
    }
    // an overdue projected row (own < today) does not move the balance on its own day
  }
  // Overdue expenses are owed from today on; overdue income is not credited.
  if (overdueOwed !== 0) {
    openFlowByDay.set(today, (openFlowByDay.get(today) ?? 0) - overdueOwed);
  }

  let completedFromStart = 0; // completed flows effective on/after the first requested day
  let openBeforeStart = 0; // open flows that already happened (in the projection) before it
  completedFlowByDay.forEach((value, day) => {
    if (day >= startKey) completedFromStart += value;
  });
  openFlowByDay.forEach((value, day) => {
    if (day < startKey) openBeforeStart += value;
  });

  // Opening balance of the first day: realized B, undo what was completed from that day on,
  // and add the open flows that already happened (in the projection) before it.
  let runningBalance = cleanMoney(currentBalance - completedFromStart + openBeforeStart);

  const first = dayNumberOfDate(startDate);
  const last = dayNumberOfDate(endDate);

  for (let n = first; n <= last; n++) {
    const dateKey = formatDate(dateFromDayNumber(n));
    const dayTransactions = rowsByDay.get(dateKey) || [];

    let income = 0;
    let expenses = 0;
    let projectedIncome = 0;
    let projectedExpenses = 0;
    dayTransactions.forEach((t) => {
      if (t.status === "skipped") return; // listed on its day, counted nowhere
      // An overdue row is listed (flagged) on its own day but moved nothing: what is owed is
      // deducted on today (`overdueOwed`), so a past day's totals only count what really moved.
      if (isOverdue(t, today)) return;
      const amount = amountOf(t);
      if (t.type === "income") {
        income += amount;
        if (t.status === "projected") projectedIncome += amount;
      } else {
        expenses += amount;
        if (t.status === "projected") projectedExpenses += amount;
      }
    });

    const dayOpeningBalance = runningBalance;
    const closingBalance = cleanMoney(
      runningBalance + (completedFlowByDay.get(dateKey) ?? 0) + (openFlowByDay.get(dateKey) ?? 0)
    );

    const day: DayBalance = {
      date: dateKey,
      openingBalance: dayOpeningBalance,
      closingBalance,
      totalIncome: income,
      totalExpenses: expenses,
      movedIncome: movedIncomeByDay.get(dateKey) ?? 0,
      movedExpenses: movedExpensesByDay.get(dateKey) ?? 0,
      projectedIncome,
      projectedExpenses,
      transactions: dayTransactions,
      status: getBalanceStatus(closingBalance, warningThreshold),
    };
    if (dateKey === today && overdueOwed > 0) day.overdueOwed = overdueOwed;
    if (dateKey === today && paidAhead.length > 0) day.paidAhead = paidAhead;
    balances.set(dateKey, day);

    runningBalance = closingBalance;
  }

  return balances;
};
