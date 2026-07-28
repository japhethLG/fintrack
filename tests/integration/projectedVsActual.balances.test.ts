import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { DayBalance, Transaction } from "@/lib/types";
import {
  calculateDailyBalances,
  calculateMonthlyTotals,
  calculateVarianceReport,
  getCategoryBreakdown,
} from "@/lib/logic/balanceCalculator";
import {
  computeBalanceFromTransactions,
  syncComputedBalance,
} from "@/lib/logic/balanceCalculator/computedBalance";
import * as store from "../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeProjectedTransaction,
  makeSkippedTransaction,
  makeTransaction,
  makeUserProfile,
} from "../helpers/builders";
import { d, daysBetween } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * THEME: the projected-vs-actual contract.
 *
 * Two decisions are made over and over in this module and are the whole point
 * of these tests:
 *   1. WHICH AMOUNT — `actualAmount` (completed only, with a fallback to
 *      `projectedAmount` when it is missing) vs `projectedAmount`.
 *   2. WHICH DATE — `actualDate || scheduledDate` (daily balances, monthly
 *      totals) vs `scheduledDate` only (variance report).
 *
 * Both are pinned exactly, including the disagreement between calculators.
 */

// ============================================================================
// LOCAL HELPERS
//
// Gap in tests/helpers/builders.ts: `makeCompletedTransaction` always fills in
// `actualAmount` (defaulting it to `projectedAmount`), so there is no builder
// for the "completed but never given an actual amount" shape that every
// `actualAmount ?? projectedAmount` fallback in this module depends on. These
// local helpers cover it.
// ============================================================================

/** A completed transaction with NO `actualAmount` — exercises the fallback. */
const completedWithoutActual = (overrides: Partial<Transaction> = {}): Transaction =>
  makeTransaction({
    status: "completed",
    actualDate: overrides.actualDate ?? overrides.scheduledDate ?? "2026-01-15",
    ...overrides,
  });

/** Fetch a day, failing loudly rather than returning undefined. */
const day = (balances: Map<string, DayBalance>, key: string): DayBalance => {
  const found = balances.get(key);
  if (!found) throw new Error(`no DayBalance for ${key}`);
  return found;
};

/** Compact, order-preserving view of the balance map for whole-array equality. */
const summarise = (balances: Map<string, DayBalance>) =>
  Array.from(balances.values()).map((b) => ({
    date: b.date,
    opening: b.openingBalance,
    closing: b.closingBalance,
    income: b.totalIncome,
    expenses: b.totalExpenses,
  }));

// ============================================================================
// calculateDailyBalances
// ============================================================================

describe("calculateDailyBalances", () => {
  describe("amount selection", () => {
    it("uses actualAmount for a completed transaction, not projectedAmount", () => {
      // Completed expense projected 100 but actually cost 150.
      // currentBalance already reflects the 150, so opening = 10000 + 150 = 10150.
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            type: "expense",
            projectedAmount: 100,
            actualAmount: 150,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 10_150, closing: 10_150, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 10_150, closing: 10_000, income: 0, expenses: 150 },
        { date: "2026-01-03", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
      ]);
    });

    it("falls back to projectedAmount when a completed transaction has no actualAmount", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          completedWithoutActual({
            type: "expense",
            projectedAmount: 100,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      // Fallback amount 100 is both reversed out of the opening balance and
      // replayed on 2026-01-02.
      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 10_100, closing: 10_100, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 10_100, closing: 10_000, income: 0, expenses: 100 },
        { date: "2026-01-03", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
      ]);
    });

    it("uses projectedAmount for a projected transaction even when actualAmount is set", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeTransaction({
            status: "projected",
            type: "expense",
            projectedAmount: 100,
            actualAmount: 999,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      // Not completed => the stray actualAmount of 999 is ignored entirely,
      // and nothing is reversed out of the opening balance.
      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 10_000, closing: 9_900, income: 0, expenses: 100 },
        { date: "2026-01-03", opening: 9_900, closing: 9_900, income: 0, expenses: 0 },
      ]);
    });
  });

  describe("date selection", () => {
    it("buckets a late-paid completed transaction on its actualDate, not its scheduledDate", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            type: "expense",
            projectedAmount: 200,
            actualAmount: 200,
            scheduledDate: "2026-01-02",
            actualDate: "2026-01-04",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-05")
      );

      // The scheduled day (01-02) must be untouched...
      expect(day(balances, "2026-01-02").totalExpenses).toBe(0);
      expect(day(balances, "2026-01-02").closingBalance).toBe(10_200);
      // ...and the money must move on the actual day (01-04).
      expect(day(balances, "2026-01-04").totalExpenses).toBe(200);
      expect(day(balances, "2026-01-04").closingBalance).toBe(10_000);
    });

    it("lists a late-paid transaction only under its actual day", () => {
      const late = makeCompletedTransaction({
        id: "txn-late",
        type: "expense",
        scheduledDate: "2026-01-02",
        actualDate: "2026-01-04",
      });

      const balances = calculateDailyBalances(10_000, [late], d("2026-01-01"), d("2026-01-05"));

      expect(day(balances, "2026-01-02").transactions).toEqual([]);
      expect(day(balances, "2026-01-04").transactions.map((t) => t.id)).toEqual(["txn-late"]);
    });

    it("buckets an early-paid completed transaction on its earlier actualDate", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            type: "income",
            projectedAmount: 500,
            actualAmount: 500,
            scheduledDate: "2026-01-05",
            actualDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-05")
      );

      expect(day(balances, "2026-01-02").totalIncome).toBe(500);
      expect(day(balances, "2026-01-05").totalIncome).toBe(0);
    });

    it("buckets by scheduledDate when actualDate is absent", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeProjectedTransaction({
            type: "expense",
            projectedAmount: 300,
            scheduledDate: "2026-01-03",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-04")
      );

      expect(day(balances, "2026-01-03").totalExpenses).toBe(300);
    });
  });

  describe("skipped transactions", () => {
    it("contributes nothing to income or expenses", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeSkippedTransaction({
            type: "expense",
            projectedAmount: 300,
            scheduledDate: "2026-01-02",
          }),
          makeSkippedTransaction({
            id: "txn-2",
            type: "income",
            projectedAmount: 900,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
        { date: "2026-01-03", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
      ]);
    });

    it("is still listed in the day's transactions array so the UI can render it", () => {
      // PINNED CONTRACT: grouping happens before the skip filter, so a skipped
      // occurrence remains visible on the calendar while contributing 0.
      const skipped = makeSkippedTransaction({
        id: "txn-skipped",
        type: "expense",
        projectedAmount: 300,
        scheduledDate: "2026-01-02",
      });

      const balances = calculateDailyBalances(10_000, [skipped], d("2026-01-01"), d("2026-01-03"));

      expect(day(balances, "2026-01-02").transactions.map((t) => t.id)).toEqual(["txn-skipped"]);
    });

    it("is not reversed out of the opening balance", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeSkippedTransaction({
            type: "expense",
            projectedAmount: 300,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01")
      );

      expect(day(balances, "2026-01-01").openingBalance).toBe(10_000);
    });
  });

  describe("running balance", () => {
    it("chains each day's openingBalance to the previous day's closingBalance", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeProjectedTransaction({
            id: "p1",
            type: "expense",
            projectedAmount: 100,
            scheduledDate: "2026-01-02",
          }),
          makeProjectedTransaction({
            id: "p2",
            type: "income",
            projectedAmount: 400,
            scheduledDate: "2026-01-04",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-05")
      );

      const days = Array.from(balances.values());
      days.slice(1).forEach((current, index) => {
        expect(current.openingBalance).toBe(days[index].closingBalance);
      });
      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 10_000, closing: 9_900, income: 0, expenses: 100 },
        { date: "2026-01-03", opening: 9_900, closing: 9_900, income: 0, expenses: 0 },
        { date: "2026-01-04", opening: 9_900, closing: 10_300, income: 400, expenses: 0 },
        { date: "2026-01-05", opening: 10_300, closing: 10_300, income: 0, expenses: 0 },
      ]);
    });

    it("carries the balance forward with zero income and expenses on empty days", () => {
      const balances = calculateDailyBalances(2_500, [], d("2026-01-01"), d("2026-01-03"));

      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 2_500, closing: 2_500, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 2_500, closing: 2_500, income: 0, expenses: 0 },
        { date: "2026-01-03", opening: 2_500, closing: 2_500, income: 0, expenses: 0 },
      ]);
      expect(day(balances, "2026-01-02").transactions).toEqual([]);
    });

    it("nets multiple transactions landing on the same day", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeProjectedTransaction({
            id: "p1",
            type: "income",
            projectedAmount: 1_000,
            scheduledDate: "2026-01-02",
          }),
          makeProjectedTransaction({
            id: "p2",
            type: "expense",
            projectedAmount: 250,
            scheduledDate: "2026-01-02",
          }),
          makeProjectedTransaction({
            id: "p3",
            type: "expense",
            projectedAmount: 150,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-02"),
        d("2026-01-02")
      );

      expect(summarise(balances)).toEqual([
        { date: "2026-01-02", opening: 10_000, closing: 10_600, income: 1_000, expenses: 400 },
      ]);
    });
  });

  describe("opening balance derivation", () => {
    it("reverses completed transactions out of currentBalance to find the start point", () => {
      // currentBalance 10000 already includes a completed income of 2000 and a
      // completed expense of 500, so the pre-transaction opening balance is
      // 10000 - 2000 + 500 = 8500. Replaying both returns to 10000.
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            id: "inc",
            type: "income",
            projectedAmount: 2_000,
            actualAmount: 2_000,
            scheduledDate: "2026-01-02",
          }),
          makeCompletedTransaction({
            id: "exp",
            type: "expense",
            projectedAmount: 500,
            actualAmount: 500,
            scheduledDate: "2026-01-03",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-04")
      );

      expect(day(balances, "2026-01-01").openingBalance).toBe(8_500);
      expect(summarise(balances)).toEqual([
        { date: "2026-01-01", opening: 8_500, closing: 8_500, income: 0, expenses: 0 },
        { date: "2026-01-02", opening: 8_500, closing: 10_500, income: 2_000, expenses: 0 },
        { date: "2026-01-03", opening: 10_500, closing: 10_000, income: 0, expenses: 500 },
        { date: "2026-01-04", opening: 10_000, closing: 10_000, income: 0, expenses: 0 },
      ]);
    });

    it("reverses the actualAmount, not the projectedAmount, of a completed transaction", () => {
      // Actual 700 (not projected 500) is what currentBalance reflects:
      // opening = 10000 + 700 = 10700.
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            type: "expense",
            projectedAmount: 500,
            actualAmount: 700,
            scheduledDate: "2026-01-01",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01")
      );

      expect(day(balances, "2026-01-01").openingBalance).toBe(10_700);
      expect(day(balances, "2026-01-01").closingBalance).toBe(10_000);
    });

    it("leaves the opening balance at currentBalance when nothing is completed", () => {
      const balances = calculateDailyBalances(
        7_777,
        [
          makeProjectedTransaction({ projectedAmount: 100, scheduledDate: "2026-01-02" }),
          makeSkippedTransaction({ id: "s1", projectedAmount: 100, scheduledDate: "2026-01-02" }),
        ],
        d("2026-01-01"),
        d("2026-01-01")
      );

      expect(day(balances, "2026-01-01").openingBalance).toBe(7_777);
    });
  });

  describe("status thresholds", () => {
    it('is "safe" when the closing balance equals the warning threshold exactly', () => {
      const balances = calculateDailyBalances(
        1_000,
        [
          makeProjectedTransaction({
            type: "expense",
            projectedAmount: 500,
            scheduledDate: "2026-01-01",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01"),
        500
      );

      expect(day(balances, "2026-01-01").closingBalance).toBe(500);
      expect(day(balances, "2026-01-01").status).toBe("safe");
    });

    it('is "warning" one unit below the threshold', () => {
      const balances = calculateDailyBalances(
        1_000,
        [
          makeProjectedTransaction({
            type: "expense",
            projectedAmount: 501,
            scheduledDate: "2026-01-01",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01"),
        500
      );

      expect(day(balances, "2026-01-01").closingBalance).toBe(499);
      expect(day(balances, "2026-01-01").status).toBe("warning");
    });

    it('is "warning" at exactly zero when the threshold is above zero', () => {
      const balances = calculateDailyBalances(
        1_000,
        [
          makeProjectedTransaction({
            type: "expense",
            projectedAmount: 1_000,
            scheduledDate: "2026-01-01",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01"),
        500
      );

      expect(day(balances, "2026-01-01").closingBalance).toBe(0);
      expect(day(balances, "2026-01-01").status).toBe("warning");
    });

    it('is "safe" at exactly zero when the threshold is zero', () => {
      const balances = calculateDailyBalances(0, [], d("2026-01-01"), d("2026-01-01"), 0);

      expect(day(balances, "2026-01-01").status).toBe("safe");
    });

    it('is "danger" as soon as the closing balance goes below zero', () => {
      const balances = calculateDailyBalances(
        1_000,
        [
          makeProjectedTransaction({
            type: "expense",
            projectedAmount: 1_001,
            scheduledDate: "2026-01-01",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-01"),
        500
      );

      expect(day(balances, "2026-01-01").closingBalance).toBe(-1);
      expect(day(balances, "2026-01-01").status).toBe("danger");
    });

    it("defaults the warning threshold to 500 when it is not supplied", () => {
      const balances = calculateDailyBalances(
        499,
        [],
        d("2026-01-01"),
        d("2026-01-01")
        // no threshold argument
      );

      expect(day(balances, "2026-01-01").status).toBe("warning");
    });

    it("re-evaluates status per day as the running balance moves", () => {
      const balances = calculateDailyBalances(
        1_000,
        [
          makeProjectedTransaction({
            id: "p1",
            type: "expense",
            projectedAmount: 600,
            scheduledDate: "2026-01-02",
          }),
          makeProjectedTransaction({
            id: "p2",
            type: "expense",
            projectedAmount: 500,
            scheduledDate: "2026-01-03",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03"),
        500
      );

      expect(Array.from(balances.values()).map((b) => b.status)).toEqual([
        "safe", // 1000
        "warning", // 400
        "danger", // -100
      ]);
    });
  });

  describe("date range coverage", () => {
    it("keys every day in the range inclusive as YYYY-MM-DD, across a month boundary", () => {
      const balances = calculateDailyBalances(1_000, [], d("2026-01-28"), d("2026-02-02"));

      expect(Array.from(balances.keys())).toEqual(daysBetween("2026-01-28", "2026-02-02"));
      expect(Array.from(balances.keys())).toEqual([
        "2026-01-28",
        "2026-01-29",
        "2026-01-30",
        "2026-01-31",
        "2026-02-01",
        "2026-02-02",
      ]);
    });

    it("returns a single day when start and end are the same day", () => {
      const balances = calculateDailyBalances(1_000, [], d("2026-03-15"), d("2026-03-15"));

      expect(Array.from(balances.keys())).toEqual(["2026-03-15"]);
    });

    it("returns an empty map when end is before start", () => {
      const balances = calculateDailyBalances(1_000, [], d("2026-03-15"), d("2026-03-14"));

      expect(balances.size).toBe(0);
    });

    it("mirrors each map key in the DayBalance.date field", () => {
      const balances = calculateDailyBalances(1_000, [], d("2026-02-27"), d("2026-03-01"));

      balances.forEach((value, key) => expect(value.date).toBe(key));
    });

    it("covers a leap-year February 29 in the range", () => {
      const balances = calculateDailyBalances(1_000, [], d("2028-02-28"), d("2028-03-01"));

      expect(Array.from(balances.keys())).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: pre-window completed transactions corrupt every balance in the window.
     *
     * `dailyBalance.ts:27-40` reverses EVERY completed transaction in the list out
     * of `currentBalance`, but the replay loop (`dailyBalance.ts:55-94`) only walks
     * days inside [startDate, endDate]. A transaction completed before startDate is
     * therefore subtracted from the opening balance and never added back, so every
     * day in the window is off by that amount. The caller makes this certain:
     * `subscribeToStoredTransactions` fetches the user's ENTIRE transaction history
     * with no date filter (app/lib/firebase/firestore/transactions.ts:347-357).
     *
     * CORRECT: only completed transactions whose effective day falls inside the
     * window should be reversed, so the first opening balance here is 10000.
     * OBSERVED: 10500 (the 500 expense is added back and never re-spent).
     */
    it.fails(
      "KNOWN DEFECT: excludes pre-window completed transactions from the opening balance",
      () => {
        const balances = calculateDailyBalances(
          10_000,
          [
            makeCompletedTransaction({
              type: "expense",
              projectedAmount: 500,
              actualAmount: 500,
              scheduledDate: "2025-12-01",
              actualDate: "2025-12-01",
            }),
          ],
          d("2026-01-01"),
          d("2026-01-05")
        );

        expect(day(balances, "2026-01-01").openingBalance).toBe(10_000);
      }
    );

    /**
     * Same defect, second symptom: because the reversal is never replayed, the
     * whole window is shifted, not just day one — the final closing balance no
     * longer reconciles with the caller's `currentBalance`.
     */
    it.fails("KNOWN DEFECT: keeps the window reconciled with currentBalance", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeCompletedTransaction({
            type: "income",
            projectedAmount: 1_000,
            actualAmount: 1_000,
            scheduledDate: "2025-11-20",
            actualDate: "2025-11-20",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      // No transactions fall in the window, so the balance should be flat at 10000.
      // OBSERVED: flat at 9000 (the pre-window income is subtracted, never re-added).
      expect(day(balances, "2026-01-03").closingBalance).toBe(10_000);
    });

    /**
     * DEFECT: `projectedIncome` / `projectedExpenses` are hardcoded to 0.
     *
     * `dailyBalance.ts:87-88` writes literal zeros — every day of every window
     * reports 0 / 0 regardless of what it holds. The `DayBalance` type
     * (app/lib/types.ts:296-306) advertises a projected-vs-actual split
     * alongside `totalIncome`/`totalExpenses`, but the calculator never
     * populates it, so no consumer can render "projected vs actual" per day.
     *
     * CORRECT: a day holding a projected income of 1000 and a projected expense
     * of 400 should report projectedIncome 1000 / projectedExpenses 400.
     * OBSERVED: 0 / 0.
     *
     * Deliberately ONE test for this behaviour: the input below is all
     * `projected`, so it reads the same under either reasonable definition of
     * the fields (the projected-status subtotal, or the projected amount of
     * every non-skipped row). No sibling test pins the hardcoded 0s, because
     * doing so would turn a correct fix into a test failure.
     */
    it.fails("KNOWN DEFECT: populates projectedIncome and projectedExpenses per day", () => {
      const balances = calculateDailyBalances(
        10_000,
        [
          makeProjectedTransaction({
            id: "p1",
            type: "income",
            projectedAmount: 1_000,
            scheduledDate: "2026-01-02",
          }),
          makeProjectedTransaction({
            id: "p2",
            type: "expense",
            projectedAmount: 400,
            scheduledDate: "2026-01-02",
          }),
        ],
        d("2026-01-01"),
        d("2026-01-03")
      );

      expect(day(balances, "2026-01-02").projectedIncome).toBe(1_000);
      expect(day(balances, "2026-01-02").projectedExpenses).toBe(400);
    });
  });
});

// ============================================================================
// computeBalanceFromTransactions
// ============================================================================

describe("computeBalanceFromTransactions", () => {
  it("returns the initial balance for an empty transaction list", () => {
    expect(computeBalanceFromTransactions(10_000, [])).toBe(10_000);
  });

  it("adds completed income and subtracts completed expenses", () => {
    // 10000 + 3200 - 1150 = 12050
    const balance = computeBalanceFromTransactions(10_000, [
      makeCompletedTransaction({
        id: "inc",
        type: "income",
        projectedAmount: 3_000,
        actualAmount: 3_200,
      }),
      makeCompletedTransaction({
        id: "exp",
        type: "expense",
        projectedAmount: 1_200,
        actualAmount: 1_150,
      }),
    ]);

    expect(balance).toBe(12_050);
  });

  it("prefers actualAmount over projectedAmount", () => {
    const balance = computeBalanceFromTransactions(1_000, [
      makeCompletedTransaction({ type: "expense", projectedAmount: 100, actualAmount: 250 }),
    ]);

    expect(balance).toBe(750);
  });

  it("falls back to projectedAmount when actualAmount is undefined", () => {
    const balance = computeBalanceFromTransactions(1_000, [
      completedWithoutActual({ type: "expense", projectedAmount: 100 }),
    ]);

    expect(balance).toBe(900);
  });

  it("treats an actualAmount of 0 as a real zero rather than falling back", () => {
    // `?? ` (not `||`) means a genuinely free bill must not fall back to 100.
    const balance = computeBalanceFromTransactions(1_000, [
      makeCompletedTransaction({ type: "expense", projectedAmount: 100, actualAmount: 0 }),
    ]);

    expect(balance).toBe(1_000);
  });

  it("ignores projected transactions", () => {
    const balance = computeBalanceFromTransactions(1_000, [
      makeProjectedTransaction({ type: "expense", projectedAmount: 400 }),
      makeProjectedTransaction({ id: "p2", type: "income", projectedAmount: 900 }),
    ]);

    expect(balance).toBe(1_000);
  });

  it("ignores skipped transactions even when they carry an actualAmount", () => {
    const balance = computeBalanceFromTransactions(1_000, [
      makeSkippedTransaction({ type: "expense", projectedAmount: 400, actualAmount: 400 }),
    ]);

    expect(balance).toBe(1_000);
  });

  it("produces the same balance regardless of transaction order", () => {
    const transactions = [
      makeCompletedTransaction({ id: "a", type: "income", actualAmount: 500 }),
      makeCompletedTransaction({ id: "b", type: "expense", actualAmount: 120 }),
      makeProjectedTransaction({ id: "c", type: "expense", projectedAmount: 9_999 }),
      makeSkippedTransaction({ id: "e", type: "income", projectedAmount: 7_777 }),
      completedWithoutActual({ id: "f", type: "expense", projectedAmount: 80 }),
    ];
    const shuffled = [
      transactions[3],
      transactions[0],
      transactions[4],
      transactions[2],
      transactions[1],
    ];

    // 1000 + 500 - 120 - 80 = 1300
    expect(computeBalanceFromTransactions(1_000, transactions)).toBe(1_300);
    expect(computeBalanceFromTransactions(1_000, shuffled)).toBe(1_300);
  });

  it("ignores scheduledDate and actualDate entirely — every completed row counts", () => {
    const balance = computeBalanceFromTransactions(1_000, [
      makeCompletedTransaction({
        id: "old",
        type: "expense",
        actualAmount: 100,
        scheduledDate: "2020-01-01",
        actualDate: "2020-01-01",
      }),
      makeCompletedTransaction({
        id: "future",
        type: "expense",
        actualAmount: 200,
        scheduledDate: "2099-01-01",
        actualDate: "2099-01-01",
      }),
    ]);

    expect(balance).toBe(700);
  });
});

// ============================================================================
// syncComputedBalance
// ============================================================================

describe("syncComputedBalance", () => {
  beforeEach(() => store.__reset());

  it("returns the balance computed from initialBalance plus completed transactions", async () => {
    store.__seed(
      "users",
      "user-1",
      makeUserProfile({ uid: "user-1", initialBalance: 10_000, currentBalance: 0 })
    );

    // 10000 + 2500 - 450 = 12050
    const result = await syncComputedBalance("user-1", [
      makeCompletedTransaction({
        id: "inc",
        type: "income",
        projectedAmount: 2_000,
        actualAmount: 2_500,
      }),
      makeCompletedTransaction({
        id: "exp",
        type: "expense",
        projectedAmount: 500,
        actualAmount: 450,
      }),
    ]);

    expect(result).toBe(12_050);
  });

  it("persists the computed balance onto the user profile", async () => {
    store.__seed(
      "users",
      "user-1",
      makeUserProfile({ uid: "user-1", initialBalance: 10_000, currentBalance: 0 })
    );

    await syncComputedBalance("user-1", [
      makeCompletedTransaction({ type: "expense", projectedAmount: 100, actualAmount: 175 }),
    ]);

    expect(store.__get<{ currentBalance: number }>("users", "user-1")?.currentBalance).toBe(9_825);
  });

  it("recomputes from initialBalance and overwrites a stale currentBalance", async () => {
    store.__seed(
      "users",
      "user-1",
      makeUserProfile({ uid: "user-1", initialBalance: 1_000, currentBalance: 999_999 })
    );

    const result = await syncComputedBalance("user-1", [
      makeCompletedTransaction({ type: "income", projectedAmount: 200, actualAmount: 200 }),
    ]);

    // Derived from initialBalance (1000), not from the stale currentBalance.
    expect(result).toBe(1_200);
    expect(store.__get<{ currentBalance: number }>("users", "user-1")?.currentBalance).toBe(1_200);
  });

  it("stamps balanceLastUpdatedAt with today's date", async () => {
    freezeToday("2026-03-15");
    store.__seed(
      "users",
      "user-1",
      makeUserProfile({ uid: "user-1", initialBalance: 500, balanceLastUpdatedAt: "2026-01-01" })
    );

    await syncComputedBalance("user-1", []);

    expect(
      store.__get<{ balanceLastUpdatedAt: string }>("users", "user-1")?.balanceLastUpdatedAt
    ).toBe("2026-03-15");
  });

  it("ignores projected and skipped transactions when syncing", async () => {
    store.__seed("users", "user-1", makeUserProfile({ uid: "user-1", initialBalance: 5_000 }));

    const result = await syncComputedBalance("user-1", [
      makeProjectedTransaction({ id: "p", type: "expense", projectedAmount: 1_000 }),
      makeSkippedTransaction({ id: "s", type: "expense", projectedAmount: 2_000 }),
      makeCompletedTransaction({
        id: "c",
        type: "expense",
        projectedAmount: 300,
        actualAmount: 300,
      }),
    ]);

    expect(result).toBe(4_700);
    expect(store.__get<{ currentBalance: number }>("users", "user-1")?.currentBalance).toBe(4_700);
  });

  it("throws when the user profile does not exist", async () => {
    await expect(syncComputedBalance("missing-user", [])).rejects.toThrow("User profile not found");
  });

  it("does not write anything when the profile is missing", async () => {
    await expect(syncComputedBalance("missing-user", [])).rejects.toThrow();

    expect(store.__opsFor("users")).toEqual([]);
  });
});

// ============================================================================
// calculateVarianceReport
// ============================================================================

describe("calculateVarianceReport", () => {
  describe("transaction selection", () => {
    it("counts only completed transactions", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "c",
            type: "expense",
            projectedAmount: 100,
            actualAmount: 120,
            scheduledDate: "2026-01-10",
          }),
          makeProjectedTransaction({
            id: "p",
            type: "expense",
            projectedAmount: 999,
            scheduledDate: "2026-01-11",
          }),
          makeSkippedTransaction({
            id: "s",
            type: "expense",
            projectedAmount: 888,
            actualAmount: 888,
            scheduledDate: "2026-01-12",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses).toEqual({
        projected: 100,
        actual: 120,
        variance: 20,
        variancePercent: 20,
      });
    });

    it("includes transactions scheduled on both boundary dates", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "first",
            type: "expense",
            projectedAmount: 100,
            actualAmount: 100,
            scheduledDate: "2026-01-01",
          }),
          makeCompletedTransaction({
            id: "last",
            type: "expense",
            projectedAmount: 200,
            actualAmount: 200,
            scheduledDate: "2026-01-31",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.projected).toBe(300);
      expect(report.expenses.actual).toBe(300);
    });

    it("excludes transactions scheduled one day outside either boundary", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "before",
            type: "expense",
            projectedAmount: 100,
            actualAmount: 100,
            scheduledDate: "2025-12-31",
          }),
          makeCompletedTransaction({
            id: "after",
            type: "expense",
            projectedAmount: 200,
            actualAmount: 200,
            scheduledDate: "2026-02-01",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.projected).toBe(0);
      expect(report.expenses.actual).toBe(0);
      expect(report.byCategory).toEqual([]);
    });

    it("filters on scheduledDate, so a bill scheduled inside but paid after is included", () => {
      // PINNED CONTRACT (variance.ts:20-22): the variance report answers "how
      // did the PLAN for this period turn out", so it keys on the planned day.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            projectedAmount: 100,
            actualAmount: 130,
            scheduledDate: "2026-01-30",
            actualDate: "2026-02-02",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.actual).toBe(130);
    });

    it("filters on scheduledDate, so a bill scheduled outside but paid inside is excluded", () => {
      // NOTE: this is the deliberate mirror of the test above and is defensible
      // on its own terms (each completed row lands in exactly one variance
      // period, so nothing is double-counted or lost). It does however DISAGREE
      // with calculateDailyBalances and calculateMonthlyTotals, which both bucket
      // by `actualDate || scheduledDate` — the same payment can appear in
      // December's variance report and January's monthly totals.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            projectedAmount: 100,
            actualAmount: 130,
            scheduledDate: "2025-12-28",
            actualDate: "2026-01-03",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.actual).toBe(0);
      expect(report.byCategory).toEqual([]);
    });

    it("echoes the requested period back in the report", () => {
      const report = calculateVarianceReport([], "2026-01-01", "2026-01-31");

      expect(report.period).toEqual({ start: "2026-01-01", end: "2026-01-31" });
    });
  });

  describe("variance arithmetic", () => {
    it("computes income variance as actual minus projected", () => {
      // Earned 2800 against a plan of 3000: -200, i.e. -6.667%.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
            actualAmount: 2_800,
            scheduledDate: "2026-01-15",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.income.projected).toBe(3_000);
      expect(report.income.actual).toBe(2_800);
      expect(report.income.variance).toBe(-200);
      expect(report.income.variancePercent).toBeCloseTo(-6.6667, 2);
    });

    it("reports overspend as a positive expense variance", () => {
      // Spent 1350 against a plan of 1200: +150 = +12.5%.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            actualAmount: 1_350,
            scheduledDate: "2026-01-05",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.variance).toBe(150);
      expect(report.expenses.variancePercent).toBeCloseTo(12.5, 2);
    });

    it("reports underspend as a negative expense variance", () => {
      // Spent 900 against a plan of 1200: -300 = -25%.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            actualAmount: 900,
            scheduledDate: "2026-01-05",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.variance).toBe(-300);
      expect(report.expenses.variancePercent).toBeCloseTo(-25, 2);
    });

    it("keeps income and expense variance in separate buckets", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "inc",
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
            actualAmount: 2_800,
            scheduledDate: "2026-01-15",
          }),
          makeCompletedTransaction({
            id: "exp",
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            actualAmount: 1_350,
            scheduledDate: "2026-01-05",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.income.variance).toBe(-200);
      expect(report.expenses.variance).toBe(150);
    });

    it("treats a completed transaction with no actualAmount as zero variance", () => {
      const report = calculateVarianceReport(
        [
          completedWithoutActual({
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            scheduledDate: "2026-01-05",
          }),
          completedWithoutActual({
            id: "inc",
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
            scheduledDate: "2026-01-15",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses).toEqual({
        projected: 1_200,
        actual: 1_200,
        variance: 0,
        variancePercent: 0,
      });
      expect(report.income).toEqual({
        projected: 3_000,
        actual: 3_000,
        variance: 0,
        variancePercent: 0,
      });
      // `toContainEqual`, not `toEqual`: the point here is that the fallback
      // feeds the category row with the projected amount. Whether an income
      // ("salary") row exists alongside it is the separate, contested question
      // owned by the "tracks income variance by category" defect test below —
      // asserting its absence here would contradict that test.
      expect(report.byCategory).toContainEqual({
        category: "housing",
        projected: 1_200,
        actual: 1_200,
        variance: 0,
      });
    });

    it("returns all zeros for an empty transaction list", () => {
      const report = calculateVarianceReport([], "2026-01-01", "2026-01-31");

      expect(report.income).toEqual({
        projected: 0,
        actual: 0,
        variance: 0,
        variancePercent: 0,
      });
      expect(report.expenses).toEqual({
        projected: 0,
        actual: 0,
        variance: 0,
        variancePercent: 0,
      });
      expect(report.byCategory).toEqual([]);
    });
  });

  describe("divide-by-zero guards", () => {
    it("reports 0% income variance when nothing was projected", () => {
      // Unplanned income: projected 0, actual 500. Percent would be Infinity.
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "income",
            category: "gift",
            projectedAmount: 0,
            actualAmount: 500,
            scheduledDate: "2026-01-10",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.income.variance).toBe(500);
      expect(report.income.variancePercent).toBe(0);
      expect(Number.isFinite(report.income.variancePercent)).toBe(true);
    });

    it("reports 0% expense variance when nothing was projected", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            category: "medical",
            projectedAmount: 0,
            actualAmount: 300,
            scheduledDate: "2026-01-10",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.expenses.variance).toBe(300);
      expect(report.expenses.variancePercent).toBe(0);
      expect(Number.isNaN(report.expenses.variancePercent)).toBe(false);
    });

    it("still records the category row for a fully unplanned expense", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            type: "expense",
            category: "medical",
            projectedAmount: 0,
            actualAmount: 300,
            scheduledDate: "2026-01-10",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.byCategory).toEqual([
        { category: "medical", projected: 0, actual: 300, variance: 300 },
      ]);
    });
  });

  describe("byCategory breakdown", () => {
    it("aggregates multiple transactions in the same category", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "f1",
            type: "expense",
            category: "food",
            projectedAmount: 100,
            actualAmount: 130,
            scheduledDate: "2026-01-05",
          }),
          makeCompletedTransaction({
            id: "f2",
            type: "expense",
            category: "food",
            projectedAmount: 200,
            actualAmount: 190,
            scheduledDate: "2026-01-20",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.byCategory).toEqual([
        { category: "food", projected: 300, actual: 320, variance: 20 },
      ]);
    });

    it("keeps distinct categories as separate rows in first-seen order", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "h",
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            actualAmount: 1_200,
            scheduledDate: "2026-01-05",
          }),
          makeCompletedTransaction({
            id: "f",
            type: "expense",
            category: "food",
            projectedAmount: 400,
            actualAmount: 450,
            scheduledDate: "2026-01-06",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.byCategory).toEqual([
        { category: "housing", projected: 1_200, actual: 1_200, variance: 0 },
        { category: "food", projected: 400, actual: 450, variance: 50 },
      ]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: income variance by category is silently lost.
     *
     * `variance.ts:35-47` only writes to `categoryMap` inside the `else`
     * (expense) branch, so `byCategory` covers EXPENSES ONLY. The
     * `VarianceReport.byCategory` type (app/lib/types.ts:354-359) is not typed
     * or named as expense-only, and the income totals ARE tracked at the top
     * level — so a user who under-earned on one income category cannot see
     * which one. Any UI that renders `byCategory` as "variance by category"
     * shows a silently incomplete picture.
     *
     * CORRECT: a completed income transaction should contribute a category row
     * (salary: projected 3000, actual 2800, variance -200).
     * OBSERVED: byCategory contains only the "housing" expense row — today the
     * income row simply does not exist.
     *
     * Deliberately ONE test for this behaviour. No sibling test pins
     * "byCategory lists expenses only", because that would make fixing
     * variance.ts:42-46 look like a regression. `toContainEqual` (not `toEqual`)
     * also leaves the row ORDER of a fixed implementation free — only the
     * presence of the income row is required.
     */
    it.fails("KNOWN DEFECT: tracks income variance by category as well as expenses", () => {
      const report = calculateVarianceReport(
        [
          makeCompletedTransaction({
            id: "inc",
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
            actualAmount: 2_800,
            scheduledDate: "2026-01-15",
          }),
          makeCompletedTransaction({
            id: "exp",
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
            actualAmount: 1_350,
            scheduledDate: "2026-01-05",
          }),
        ],
        "2026-01-01",
        "2026-01-31"
      );

      expect(report.byCategory).toContainEqual({
        category: "salary",
        projected: 3_000,
        actual: 2_800,
        variance: -200,
      });
    });
  });
});

// ============================================================================
// calculateMonthlyTotals
// ============================================================================

describe("calculateMonthlyTotals", () => {
  describe("amount selection", () => {
    it("uses actualAmount for completed and projectedAmount for projected rows", () => {
      // income   = 3200 (actual) + 1000 (projected) = 4200
      // expenses = 1150 (actual) +  400 (projected) = 1550
      const totals = calculateMonthlyTotals(
        [
          makeCompletedTransaction({
            id: "inc-c",
            type: "income",
            projectedAmount: 3_000,
            actualAmount: 3_200,
            scheduledDate: "2026-01-01",
          }),
          makeProjectedTransaction({
            id: "inc-p",
            type: "income",
            projectedAmount: 1_000,
            scheduledDate: "2026-01-15",
          }),
          makeCompletedTransaction({
            id: "exp-c",
            type: "expense",
            projectedAmount: 1_200,
            actualAmount: 1_150,
            scheduledDate: "2026-01-05",
          }),
          makeProjectedTransaction({
            id: "exp-p",
            type: "expense",
            projectedAmount: 400,
            scheduledDate: "2026-01-31",
          }),
        ],
        2026,
        0
      );

      expect(totals).toEqual({ income: 4_200, expenses: 1_550, net: 2_650 });
    });

    it("falls back to projectedAmount for a completed row with no actualAmount", () => {
      const totals = calculateMonthlyTotals(
        [
          completedWithoutActual({
            type: "expense",
            projectedAmount: 275,
            scheduledDate: "2026-01-10",
          }),
        ],
        2026,
        0
      );

      expect(totals).toEqual({ income: 0, expenses: 275, net: -275 });
    });

    it("ignores an actualAmount attached to a projected row", () => {
      const totals = calculateMonthlyTotals(
        [
          makeTransaction({
            status: "projected",
            type: "expense",
            projectedAmount: 100,
            actualAmount: 999,
            scheduledDate: "2026-01-10",
          }),
        ],
        2026,
        0
      );

      expect(totals).toEqual({ income: 0, expenses: 100, net: -100 });
    });

    it("excludes skipped transactions", () => {
      const totals = calculateMonthlyTotals(
        [
          makeSkippedTransaction({
            type: "expense",
            projectedAmount: 500,
            actualAmount: 500,
            scheduledDate: "2026-01-20",
          }),
        ],
        2026,
        0
      );

      expect(totals).toEqual({ income: 0, expenses: 0, net: 0 });
    });

    it("computes net as income minus expenses, including when negative", () => {
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "inc",
            type: "income",
            projectedAmount: 1_000,
            scheduledDate: "2026-01-10",
          }),
          makeProjectedTransaction({
            id: "exp",
            type: "expense",
            projectedAmount: 1_600,
            scheduledDate: "2026-01-11",
          }),
        ],
        2026,
        0
      );

      expect(totals.net).toBe(-600);
      expect(totals.net).toBe(totals.income - totals.expenses);
    });

    it("returns zeros for an empty list", () => {
      expect(calculateMonthlyTotals([], 2026, 0)).toEqual({ income: 0, expenses: 0, net: 0 });
    });
  });

  describe("date bucketing", () => {
    it("counts a bill scheduled in January but paid in February against February", () => {
      const late = makeCompletedTransaction({
        type: "expense",
        projectedAmount: 200,
        actualAmount: 200,
        scheduledDate: "2026-01-31",
        actualDate: "2026-02-02",
      });

      expect(calculateMonthlyTotals([late], 2026, 0).expenses).toBe(0);
      expect(calculateMonthlyTotals([late], 2026, 1).expenses).toBe(200);
    });

    it("counts a bill scheduled in February but paid in January against January", () => {
      const early = makeCompletedTransaction({
        type: "income",
        projectedAmount: 500,
        actualAmount: 500,
        scheduledDate: "2026-02-02",
        actualDate: "2026-01-30",
      });

      expect(calculateMonthlyTotals([early], 2026, 0).income).toBe(500);
      expect(calculateMonthlyTotals([early], 2026, 1).income).toBe(0);
    });

    it("includes both the 1st and the last day of the month", () => {
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "first",
            type: "expense",
            projectedAmount: 10,
            scheduledDate: "2026-01-01",
          }),
          makeProjectedTransaction({
            id: "last",
            type: "expense",
            projectedAmount: 20,
            scheduledDate: "2026-01-31",
          }),
        ],
        2026,
        0
      );

      expect(totals.expenses).toBe(30);
    });

    it("excludes the days immediately either side of the month", () => {
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "before",
            type: "expense",
            projectedAmount: 10,
            scheduledDate: "2025-12-31",
          }),
          makeProjectedTransaction({
            id: "after",
            type: "expense",
            projectedAmount: 20,
            scheduledDate: "2026-02-01",
          }),
        ],
        2026,
        0
      );

      expect(totals.expenses).toBe(0);
    });

    it("includes February 29 in a leap year", () => {
      // 2028 is a leap year, so the month window ends on 2028-02-29.
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "leap",
            type: "expense",
            projectedAmount: 90,
            scheduledDate: "2028-02-29",
          }),
          makeProjectedTransaction({
            id: "march",
            type: "expense",
            projectedAmount: 10,
            scheduledDate: "2028-03-01",
          }),
        ],
        2028,
        1
      );

      expect(totals.expenses).toBe(90);
    });

    it("ends a non-leap February on the 28th", () => {
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "feb28",
            type: "expense",
            projectedAmount: 90,
            scheduledDate: "2026-02-28",
          }),
          makeProjectedTransaction({
            id: "mar1",
            type: "expense",
            projectedAmount: 10,
            scheduledDate: "2026-03-01",
          }),
        ],
        2026,
        1
      );

      expect(totals.expenses).toBe(90);
    });

    it("handles December (month index 11) without spilling into the next year", () => {
      const totals = calculateMonthlyTotals(
        [
          makeProjectedTransaction({
            id: "dec1",
            type: "expense",
            projectedAmount: 40,
            scheduledDate: "2026-12-01",
          }),
          makeProjectedTransaction({
            id: "dec31",
            type: "expense",
            projectedAmount: 60,
            scheduledDate: "2026-12-31",
          }),
          makeProjectedTransaction({
            id: "jan1",
            type: "expense",
            projectedAmount: 100,
            scheduledDate: "2027-01-01",
          }),
        ],
        2026,
        11
      );

      expect(totals.expenses).toBe(100);
    });

    it("keeps the same calendar month in different years apart", () => {
      const transactions = [
        makeProjectedTransaction({
          id: "y2026",
          type: "expense",
          projectedAmount: 100,
          scheduledDate: "2026-01-15",
        }),
        makeProjectedTransaction({
          id: "y2027",
          type: "expense",
          projectedAmount: 200,
          scheduledDate: "2027-01-15",
        }),
      ];

      expect(calculateMonthlyTotals(transactions, 2026, 0).expenses).toBe(100);
      expect(calculateMonthlyTotals(transactions, 2027, 0).expenses).toBe(200);
    });
  });
});

// ============================================================================
// getCategoryBreakdown
// ============================================================================

describe("getCategoryBreakdown", () => {
  describe("totals and ordering", () => {
    it("returns an empty array for an empty transaction list", () => {
      expect(getCategoryBreakdown([])).toEqual([]);
    });

    it("sorts categories by total descending", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({
            id: "h",
            type: "expense",
            category: "housing",
            projectedAmount: 1_200,
          }),
          makeProjectedTransaction({
            id: "f",
            type: "expense",
            category: "food",
            projectedAmount: 300,
          }),
          makeProjectedTransaction({
            id: "t",
            type: "expense",
            category: "transport",
            projectedAmount: 500,
          }),
        ],
        "expense"
      );

      // grandTotal 2000 -> 60% / 25% / 15%
      expect(breakdown).toEqual([
        { category: "housing", total: 1_200, percentage: 60 },
        { category: "transport", total: 500, percentage: 25 },
        { category: "food", total: 300, percentage: 15 },
      ]);
    });

    it("aggregates multiple transactions in one category", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({ id: "f1", category: "food", projectedAmount: 120 }),
          makeProjectedTransaction({ id: "f2", category: "food", projectedAmount: 80 }),
        ],
        "expense"
      );

      expect(breakdown).toEqual([{ category: "food", total: 200, percentage: 100 }]);
    });

    it("produces percentages that sum to 100 across the included rows", () => {
      // Three equal categories -> 33.333...% each, which must still sum to 100.
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({ id: "a", category: "food", projectedAmount: 100 }),
          makeProjectedTransaction({ id: "b", category: "housing", projectedAmount: 100 }),
          makeProjectedTransaction({ id: "c", category: "transport", projectedAmount: 100 }),
        ],
        "expense"
      );

      expect(breakdown.map((row) => row.percentage)).toEqual([
        expect.closeTo(33.3333, 3),
        expect.closeTo(33.3333, 3),
        expect.closeTo(33.3333, 3),
      ]);
      expect(breakdown.reduce((sum, row) => sum + row.percentage, 0)).toBeCloseTo(100, 10);
    });
  });

  describe("amount selection", () => {
    it("uses actualAmount for completed rows and projectedAmount for projected rows", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeCompletedTransaction({
            id: "c",
            type: "expense",
            category: "housing",
            projectedAmount: 100,
            actualAmount: 150,
          }),
          makeProjectedTransaction({
            id: "p",
            type: "expense",
            category: "food",
            projectedAmount: 50,
          }),
        ],
        "expense"
      );

      // grandTotal 200 -> housing 75%, food 25%
      expect(breakdown).toEqual([
        { category: "housing", total: 150, percentage: 75 },
        { category: "food", total: 50, percentage: 25 },
      ]);
    });

    it("falls back to projectedAmount for a completed row with no actualAmount", () => {
      const breakdown = getCategoryBreakdown(
        [completedWithoutActual({ type: "expense", category: "housing", projectedAmount: 400 })],
        "expense"
      );

      expect(breakdown).toEqual([{ category: "housing", total: 400, percentage: 100 }]);
    });

    it("ignores an actualAmount attached to a projected row", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeTransaction({
            status: "projected",
            type: "expense",
            category: "housing",
            projectedAmount: 100,
            actualAmount: 999,
          }),
        ],
        "expense"
      );

      expect(breakdown).toEqual([{ category: "housing", total: 100, percentage: 100 }]);
    });
  });

  describe("filtering", () => {
    it("drops skipped transactions entirely rather than showing a zero row", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({ id: "h", category: "housing", projectedAmount: 400 }),
          makeSkippedTransaction({
            id: "f",
            category: "food",
            projectedAmount: 400,
            actualAmount: 400,
          }),
        ],
        "expense"
      );

      expect(breakdown).toEqual([{ category: "housing", total: 400, percentage: 100 }]);
    });

    it("restricts to expenses when the type filter is expense", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({
            id: "s",
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
          }),
          makeProjectedTransaction({
            id: "h",
            type: "expense",
            category: "housing",
            projectedAmount: 750,
          }),
          makeProjectedTransaction({
            id: "f",
            type: "expense",
            category: "food",
            projectedAmount: 250,
          }),
        ],
        "expense"
      );

      // grandTotal is the expense total (1000) only.
      expect(breakdown).toEqual([
        { category: "housing", total: 750, percentage: 75 },
        { category: "food", total: 250, percentage: 25 },
      ]);
    });

    it("restricts to income when the type filter is income", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({
            id: "s",
            type: "income",
            category: "salary",
            projectedAmount: 3_000,
          }),
          makeProjectedTransaction({
            id: "g",
            type: "income",
            category: "gift",
            projectedAmount: 1_000,
          }),
          makeProjectedTransaction({
            id: "h",
            type: "expense",
            category: "housing",
            projectedAmount: 9_999,
          }),
        ],
        "income"
      );

      expect(breakdown).toEqual([
        { category: "salary", total: 3_000, percentage: 75 },
        { category: "gift", total: 1_000, percentage: 25 },
      ]);
    });
  });

  describe("degenerate totals", () => {
    it("reports 0 rather than NaN when every amount is zero", () => {
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({ id: "a", category: "food", projectedAmount: 0 }),
          makeProjectedTransaction({ id: "b", category: "housing", projectedAmount: 0 }),
        ],
        "expense"
      );

      expect(breakdown).toEqual([
        { category: "food", total: 0, percentage: 0 },
        { category: "housing", total: 0, percentage: 0 },
      ]);
      breakdown.forEach((row) => expect(Number.isNaN(row.percentage)).toBe(false));
    });

    it("reports 0 rather than NaN when positive and negative amounts cancel out", () => {
      // A refund modelled as a negative expense can zero out the grand total.
      const breakdown = getCategoryBreakdown(
        [
          makeProjectedTransaction({ id: "a", category: "food", projectedAmount: 100 }),
          makeProjectedTransaction({ id: "b", category: "refund", projectedAmount: -100 }),
        ],
        "expense"
      );

      expect(breakdown.map((row) => row.percentage)).toEqual([0, 0]);
      breakdown.forEach((row) => expect(Number.isNaN(row.percentage)).toBe(false));
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: with no type filter, income and expense amounts are summed into a
     * single `grandTotal`, so every percentage is meaningless.
     *
     * `categoryBreakdown.ts:20-29` accumulates `grandTotal` across ALL non-
     * skipped transactions when `type` is undefined, then divides each category
     * by it (`categoryBreakdown.ts:35`). Income and expenses are opposite-signed
     * concepts, so the denominator is neither the income total nor the expense
     * total: a 250 housing expense out of 500 total spend is reported as 16.67%
     * because 1000 of salary was folded into the denominator. The rows are also
     * interleaved by size, so a pie chart drawn from this mixes earnings and
     * spending into one 100% circle.
     *
     * CORRECT: percentages should be relative to the row's own type total —
     * housing = 250/500 = 50%.
     * OBSERVED: rows [salary, housing, food] with totals [1000, 250, 250] and
     * percentages [66.67, 16.67, 16.67] — i.e. every row divided by the mixed
     * 1500 denominator.
     *
     * Deliberately ONE test for this behaviour. No sibling test pins those
     * observed percentages, because a correct fix necessarily changes them (and
     * may legitimately regroup or reorder the rows while doing so), which would
     * make the fix read as a regression. Only the per-type percentage is
     * asserted, so any fix that scopes the denominator correctly passes.
     */
    it.fails("KNOWN DEFECT: scopes percentages per type when no type filter is given", () => {
      const breakdown = getCategoryBreakdown([
        makeProjectedTransaction({
          id: "s",
          type: "income",
          category: "salary",
          projectedAmount: 1_000,
        }),
        makeProjectedTransaction({
          id: "h",
          type: "expense",
          category: "housing",
          projectedAmount: 250,
        }),
        makeProjectedTransaction({
          id: "f",
          type: "expense",
          category: "food",
          projectedAmount: 250,
        }),
      ]);

      // Assert the row exists FIRST so the failure below is always an
      // assertion about the percentage, never a matcher error on `undefined`.
      const housing = breakdown.find((row) => row.category === "housing");
      expect(housing).toEqual({ category: "housing", total: 250, percentage: expect.any(Number) });
      expect(housing?.percentage).toBeCloseTo(50, 2);
    });
  });
});
