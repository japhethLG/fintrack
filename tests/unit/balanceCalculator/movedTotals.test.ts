import { describe, expect, it } from "vitest";

import { calculateDailyBalances } from "@/lib/logic/balanceCalculator/dailyBalance";
import { categoryLabel } from "@/lib/utils/categoryLabel";
import { makeCompletedTransaction, makeManualTransaction } from "../../helpers/builders";
import { d } from "../../helpers/dates";

/**
 * MANUAL-M10: a day's totals must agree with its opening-to-closing change.
 * today = 2026-03-16 (Mon). Balance 1,000 already includes a 9,500 freelance income that was paid
 * ahead of its Mar 20 date; a projected 3,200 income and a 400 expense are due on Mar 20.
 *
 *   Mar 16 (today): the 9,500 MOVED today:  opening 1,000 - 9,500 = -8,500, closing 1,000
 *   Mar 20        : opening 1,000, + 3,200 - 400 = 3,800 closing; the 9,500 is LISTED here (own day)
 *                   but did not move the balance on this day.
 */
const TODAY = "2026-03-16";
const rows = [
  makeCompletedTransaction({
    id: "free",
    type: "income",
    sourceType: "manual",
    projectedAmount: 9_500,
    actualAmount: 9_500,
    scheduledDate: "2026-03-20",
    actualDate: "2026-03-20",
  }),
  makeManualTransaction({ id: "gig", type: "income", projectedAmount: 3_200, scheduledDate: "2026-03-20" }),
  makeManualTransaction({ id: "bill", type: "expense", projectedAmount: 400, scheduledDate: "2026-03-20" }),
];

describe("DayBalance.movedIncome / movedExpenses / paidAhead", () => {
  const days = calculateDailyBalances(1_000, rows, d("2026-03-15"), d("2026-03-22"), 500, TODAY);

  it("the paid-ahead day: listed totals include the 9,500, moved totals do not", () => {
    const mar20 = days.get("2026-03-20")!;
    expect(mar20.totalIncome).toBe(12_700); // what is listed on the day
    expect(mar20.movedIncome).toBe(3_200); // what moved the balance on the day
    expect(mar20.movedExpenses).toBe(400);
    expect(mar20.closingBalance - mar20.openingBalance).toBe(3_200 - 400);
  });

  it("today receives the paid-ahead row's money and lists it", () => {
    const today = days.get(TODAY)!;
    expect(today.movedIncome).toBe(9_500);
    expect(today.openingBalance).toBe(-8_500);
    expect(today.closingBalance).toBe(1_000);
    expect(today.paidAhead?.map((t) => t.id)).toEqual(["free"]);
    expect(days.get("2026-03-20")!.paidAhead).toBeUndefined();
  });

  it("every day: closing = opening + moved income - moved expenses (nothing overdue here)", () => {
    days.forEach((day) => {
      expect(day.closingBalance).toBeCloseTo(
        day.openingBalance + (day.movedIncome ?? 0) - (day.movedExpenses ?? 0),
        6
      );
    });
  });

  it("with an overdue bill the identity also subtracts overdueOwed, on today only", () => {
    const overdue = makeManualTransaction({ id: "late", type: "expense", projectedAmount: 250, scheduledDate: "2026-03-10" });
    const withOverdue = calculateDailyBalances(1_000, [...rows, overdue], d("2026-03-15"), d("2026-03-22"), 500, TODAY);
    withOverdue.forEach((day) => {
      expect(day.closingBalance).toBeCloseTo(
        day.openingBalance + (day.movedIncome ?? 0) - (day.movedExpenses ?? 0) - (day.overdueOwed ?? 0),
        6
      );
    });
    expect(withOverdue.get(TODAY)!.overdueOwed).toBe(250);
  });
});

describe("categoryLabel", () => {
  it("turns a stored code into a readable label", () => {
    expect(categoryLabel("debt_payment")).toBe("Debt Payment");
    expect(categoryLabel("freelance")).toBe("Freelance");
    expect(categoryLabel("side-gig_income")).toBe("Side Gig Income");
  });

  it("keeps a label that is already readable, and tolerates empty", () => {
    expect(categoryLabel("Salary")).toBe("Salary");
    expect(categoryLabel("Side Gig")).toBe("Side Gig");
    expect(categoryLabel("")).toBe("");
    expect(categoryLabel(undefined)).toBe("");
  });
});
