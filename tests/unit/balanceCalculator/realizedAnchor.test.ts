import { describe, expect, it } from "vitest";

import type { DayBalance, Transaction } from "@/lib/types";
import { calculateDailyBalances } from "@/lib/logic/balanceCalculator/dailyBalance";
import {
  collectOpenItems,
  compareOpenRows,
  defaultWindowStart,
  isOverdue,
} from "@/lib/logic/balanceCalculator/openItems";
import {
  makeCompletedTransaction,
  makeManualTransaction,
  makeProjectedTransaction,
  makeSkippedTransaction,
} from "../../helpers/builders";
import { d } from "../../helpers/dates";

/**
 * THEME: the daily balance series is anchored on the REALIZED balance (decision D5).
 *
 * Every figure is derived by hand in a comment. `today` is passed explicitly (the sixth argument),
 * so nothing here depends on the clock.
 *
 *   B               = users/{uid}.currentBalance = initialBalance + SUM(completed)
 *   completed row   : already inside B; history = B minus what was completed after that day
 *   upcoming row    : projected, dated today or later: applied on its own day
 *   overdue row     : projected, dated before today: listed, but moves nothing; its EXPENSE is owed
 *                     from today on (`overdueOwed`); an overdue INCOME is not credited
 */

const day = (balances: Map<string, DayBalance>, key: string): DayBalance => {
  const found = balances.get(key);
  if (!found) throw new Error(`no DayBalance for ${key}`);
  return found;
};

const bal = (
  currentBalance: number,
  txns: Transaction[],
  start: string,
  end: string,
  today: string,
  threshold = 500
) => calculateDailyBalances(currentBalance, txns, d(start), d(end), threshold, today);

const closings = (balances: Map<string, DayBalance>, keys: string[]) =>
  keys.map((key) => day(balances, key).closingBalance);

describe("anchored on the realized balance: history before the window", () => {
  // initial 10,000 with a completed 500 expense on 2025-08-05  =>  B = 9,500. Nothing else.
  const history = [
    makeCompletedTransaction({
      id: "old",
      type: "expense",
      projectedAmount: 500,
      actualAmount: 500,
      scheduledDate: "2025-08-05",
    }),
  ];

  it("a completed row older than the window does not leak into any day (UI-BAL-35)", () => {
    // window 2026-01-01 .. 01-31, today 01-15: no row in or after the window => flat at B = 9,500
    const balances = bal(9_500, history, "2026-01-01", "2026-01-31", "2026-01-15");

    expect(day(balances, "2026-01-01").openingBalance).toBe(9_500);
    expect(day(balances, "2026-01-15").openingBalance).toBe(9_500);
    expect(day(balances, "2026-01-15").closingBalance).toBe(9_500);
    expect(day(balances, "2026-01-31").closingBalance).toBe(9_500);
  });

  it("is independent of the window asked for: a wider window gives the same number for the same day (UI-BAL-36)", () => {
    const narrow = bal(9_500, history, "2026-01-01", "2026-01-31", "2026-01-15");
    const wide = bal(9_500, history, "2025-07-01", "2026-03-31", "2026-01-15");

    expect(day(narrow, "2026-01-15").closingBalance).toBe(9_500);
    expect(day(wide, "2026-01-15").closingBalance).toBe(9_500);
    // and inside the wide window the day of the expense shows the history: before 02-05... on
    // 2025-08-05 the balance falls from 10,000 to 9,500
    expect(day(wide, "2025-08-04").closingBalance).toBe(10_000);
    expect(day(wide, "2025-08-05").closingBalance).toBe(9_500);
  });

  it("a user with a balance and no transactions sees that balance on every day, never nothing (UI-DISP-14)", () => {
    const balances = bal(5_000, [], "2026-03-01", "2026-03-03", "2026-03-02");

    expect(balances.size).toBe(3);
    expect(Array.from(balances.values()).map((b) => [b.openingBalance, b.closingBalance])).toEqual([
      [5_000, 5_000],
      [5_000, 5_000],
      [5_000, 5_000],
    ]);
  });

  it("today's closing equals the realized balance when nothing is due or overdue", () => {
    // B = 1,000 + 300 income (03-05) - 100 expense (03-10) = 1,200, both completed, today 03-16
    const balances = bal(
      1_200,
      [
        makeCompletedTransaction({ id: "in", type: "income", projectedAmount: 300, scheduledDate: "2026-03-05" }),
        makeCompletedTransaction({ id: "out", type: "expense", projectedAmount: 100, scheduledDate: "2026-03-10" }),
      ],
      "2026-03-01",
      "2026-03-31",
      "2026-03-16"
    );

    // opening of 03-01 = 1,200 - 300 + 100 = 1,000 ; 03-05: 1,300 ; 03-10: 1,200 ; flat after
    expect(day(balances, "2026-03-01").openingBalance).toBe(1_000);
    expect(closings(balances, ["2026-03-04", "2026-03-05", "2026-03-10", "2026-03-16", "2026-03-31"])).toEqual([
      1_000, 1_300, 1_200, 1_200, 1_200,
    ]);
    expect(day(balances, "2026-03-16").closingBalance).toBe(1_200); // = B
  });
});

describe("overdue rows (D5): flagged, owed from today, never realized", () => {
  const TODAY = "2026-03-16";

  it("an overdue expense does not move its own day, and is deducted on today", () => {
    // B = 300, a projected 400 bill dated 03-10 (6 days ago), nothing else.
    const bill = makeProjectedTransaction({ id: "old", scheduledDate: "2026-03-10", projectedAmount: 400 });
    const balances = bal(300, [bill], "2026-03-08", "2026-03-18", TODAY);

    // history is the realized 300 on every past day, including the bill's own day
    expect(closings(balances, ["2026-03-08", "2026-03-10", "2026-03-15"])).toEqual([300, 300, 300]);
    expect(day(balances, "2026-03-10").transactions.map((t) => t.id)).toEqual(["old"]); // listed...
    expect(day(balances, "2026-03-10").totalExpenses).toBe(0); // ...but moved nothing
    // today: opens at the realized 300, owes 400, closes at -100
    expect(day(balances, TODAY).openingBalance).toBe(300);
    expect(day(balances, TODAY).overdueOwed).toBe(400);
    expect(day(balances, TODAY).closingBalance).toBe(-100);
    expect(day(balances, TODAY).status).toBe("danger");
    // and it stays owed
    expect(day(balances, "2026-03-18").closingBalance).toBe(-100);
  });

  it("an overdue income is not credited until it is received", () => {
    // B = 100, a 500 payday dated 03-10 that never arrived (overdue), a 50 bill on 03-20.
    const balances = bal(
      100,
      [
        makeProjectedTransaction({ id: "pay", type: "income", scheduledDate: "2026-03-10", projectedAmount: 500 }),
        makeProjectedTransaction({ id: "bill", scheduledDate: "2026-03-20", projectedAmount: 50 }),
      ],
      "2026-03-08",
      "2026-03-22",
      TODAY
    );

    expect(day(balances, "2026-03-10").totalIncome).toBe(0);
    expect(day(balances, TODAY).overdueOwed).toBeUndefined(); // nothing OWED: it is income
    expect(closings(balances, ["2026-03-10", TODAY, "2026-03-19", "2026-03-20"])).toEqual([100, 100, 100, 50]);
  });

  it("every day satisfies closing = opening + income - expenses - overdueOwed", () => {
    // B = 1,000. Overdue: expense 200 (03-05) and income 900 (03-06). Upcoming: income 300 and
    // expense 120 on 03-16 (today), expense 75 on 03-20. Skipped: a 999 expense on 03-18.
    const balances = bal(
      1_000,
      [
        makeProjectedTransaction({ id: "o1", scheduledDate: "2026-03-05", projectedAmount: 200 }),
        makeProjectedTransaction({ id: "o2", type: "income", scheduledDate: "2026-03-06", projectedAmount: 900 }),
        makeProjectedTransaction({ id: "u1", type: "income", scheduledDate: TODAY, projectedAmount: 300 }),
        makeProjectedTransaction({ id: "u2", scheduledDate: TODAY, projectedAmount: 120 }),
        makeProjectedTransaction({ id: "u3", scheduledDate: "2026-03-20", projectedAmount: 75 }),
        makeSkippedTransaction({ id: "s1", scheduledDate: "2026-03-18", projectedAmount: 999 }),
      ],
      "2026-03-01",
      "2026-03-31",
      TODAY
    );

    balances.forEach((b) => {
      expect(b.closingBalance).toBeCloseTo(
        b.openingBalance + b.totalIncome - b.totalExpenses - (b.overdueOwed ?? 0),
        6
      );
    });
    // today: opens 1,000; +300 -120 -200 owed = 980. 03-20: -75 = 905
    expect(day(balances, TODAY).closingBalance).toBe(980);
    expect(day(balances, "2026-03-20").closingBalance).toBe(905);
    expect(day(balances, "2026-03-31").closingBalance).toBe(905);
  });

  it("splits projectedIncome / projectedExpenses by status, overdue rows excluded (BAL-9)", () => {
    // a completed 100 and a projected 40 expense on the same upcoming day (03-20)
    const balances = bal(
      500,
      [
        makeCompletedTransaction({ id: "done", scheduledDate: "2026-03-20", projectedAmount: 100 }),
        makeProjectedTransaction({ id: "todo", scheduledDate: "2026-03-20", projectedAmount: 40 }),
      ],
      "2026-03-20",
      "2026-03-20",
      TODAY
    );

    // a completed row dated after today was paid early: it is filed today (03-16), so 03-20 only has the 40
    expect(day(balances, "2026-03-20").totalExpenses).toBe(40);
    expect(day(balances, "2026-03-20").projectedExpenses).toBe(40);
  });
});

describe("a row paid before its date is filed on the day it was paid (today)", () => {
  it("moves the money today, not on its due date", () => {
    // B = 800 after paying a 200 bill early (due 03-20, paid today 03-16).
    const early = makeCompletedTransaction({
      id: "early",
      type: "expense",
      projectedAmount: 200,
      actualAmount: 200,
      scheduledDate: "2026-03-20",
    });
    const balances = bal(800, [early], "2026-03-15", "2026-03-21", "2026-03-16");

    // 03-15 closes at 1,000 (the bill is not paid yet that day); 03-16 pays it: 800; after that flat
    expect(closings(balances, ["2026-03-15", "2026-03-16", "2026-03-20", "2026-03-21"])).toEqual([
      1_000, 800, 800, 800,
    ]);
    expect(day(balances, "2026-03-16").transactions.map((t) => t.id)).toEqual(["early"]);
    expect(day(balances, "2026-03-16").totalExpenses).toBe(200);
    expect(day(balances, "2026-03-20").transactions).toEqual([]);
  });
});

describe("open items", () => {
  it("defaultWindowStart is the first of the month two months back", () => {
    expect(defaultWindowStart("2026-03-16")).toBe("2026-01-01");
    expect(defaultWindowStart("2026-01-31")).toBe("2025-11-01");
    expect(defaultWindowStart("2026-12-05")).toBe("2026-10-01");
  });

  it("collectOpenItems splits overdue from upcoming and ignores older-than-default-window rows", () => {
    const rows = [
      makeProjectedTransaction({ id: "ancient", scheduledDate: "2025-12-31", projectedAmount: 999 }),
      makeProjectedTransaction({ id: "late", scheduledDate: "2026-01-01", projectedAmount: 40 }),
      makeProjectedTransaction({ id: "late-income", type: "income", scheduledDate: "2026-03-01", projectedAmount: 700 }),
      makeProjectedTransaction({ id: "today", scheduledDate: "2026-03-16", projectedAmount: 10 }),
      makeProjectedTransaction({ id: "future", scheduledDate: "2026-04-01", projectedAmount: 20 }),
      makeCompletedTransaction({ id: "done", scheduledDate: "2026-02-01" }),
      makeSkippedTransaction({ id: "skip", scheduledDate: "2026-02-02" }),
    ];

    const open = collectOpenItems(rows, "2026-03-16");

    // today 03-16 => default window starts 2026-01-01: the 12-31 row is older than that and not tracked
    expect(open.overdue.map((t) => t.id)).toEqual(["late", "late-income"]);
    expect(open.overdueOutflow).toBe(40); // the overdue income is never "owed"
    expect(open.upcoming.map((t) => t.id)).toEqual(["today", "future"]);
  });

  it("isOverdue: only a still-projected row dated before today", () => {
    expect(isOverdue(makeProjectedTransaction({ scheduledDate: "2026-03-15" }), "2026-03-16")).toBe(true);
    expect(isOverdue(makeProjectedTransaction({ scheduledDate: "2026-03-16" }), "2026-03-16")).toBe(false);
    expect(isOverdue(makeCompletedTransaction({ scheduledDate: "2026-03-01" }), "2026-03-16")).toBe(false);
    expect(isOverdue(makeSkippedTransaction({ scheduledDate: "2026-03-01" }), "2026-03-16")).toBe(false);
  });

  it("same-day order is income first, then name, then id, whatever the input order (UI-DISP-37)", () => {
    const a = makeManualTransaction({ id: "z", name: "Zeta", type: "expense", scheduledDate: "2026-03-20" });
    const b = makeManualTransaction({ id: "a", name: "Alpha", type: "expense", scheduledDate: "2026-03-20" });
    const pay = makeManualTransaction({ id: "p", name: "Payroll", type: "income", scheduledDate: "2026-03-20" });
    const earlier = makeManualTransaction({ id: "e", name: "Later alphabetically", type: "expense", scheduledDate: "2026-03-19" });

    const forward = [a, b, pay, earlier].sort(compareOpenRows).map((t) => t.id);
    const backward = [earlier, pay, b, a].sort(compareOpenRows).map((t) => t.id);

    expect(forward).toEqual(["e", "p", "a", "z"]);
    expect(backward).toEqual(forward);
  });
});
