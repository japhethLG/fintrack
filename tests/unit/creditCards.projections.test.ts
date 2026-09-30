import { describe, expect, it } from "vitest";
import type { CreditConfig } from "@/lib/types";
import { generateCreditProjections } from "@/lib/logic/projectionEngine/creditProjections";
import { makeCreditRule } from "../helpers/builders";
import { d } from "../helpers/dates";

/**
 * Credit card projections: first-payment clamp, emitted-date filtering, weekend
 * adjustment, full_balance, totalPayments, trapped cards and NaN guards.
 * Expected values are hand-derived (comments).
 */

const card = (
  rule: Parameters<typeof makeCreditRule>[0] = {},
  cfg: Partial<CreditConfig> = {}
) =>
  makeCreditRule(
    { startDate: "2026-01-01", ...rule },
    {
      currentBalance: 5_000,
      apr: 24,
      dueDate: 15,
      paymentStrategy: "fixed",
      fixedPaymentAmount: 500,
      ...cfg,
    }
  );

const WIDE = { start: d("2025-06-01"), end: d("2031-12-31") };
const run = (r: ReturnType<typeof card>, start = WIDE.start, end = WIDE.end) =>
  generateCreditProjections(r, start, end);
const dates = (rows: ReturnType<typeof run>) => rows.map((t) => t.scheduledDate);

describe("first payment date is clamped to the month, then steps month by month", () => {
  it("due on the 31st, tracking from Feb 10: Feb 28, Mar 31, Apr 30 (UI-RULE-46)", () => {
    // Feb 2026 has 28 days: min(31, 28) = 28 >= Feb 10, so February is the first bill.
    const rows = run(card({ startDate: "2026-02-10" }, { dueDate: 31 }));
    expect(dates(rows).slice(0, 4)).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("due on the 31st, tracking from Jan 5: Jan 31, Feb 28, Mar 31 (UI-RULE-47)", () => {
    const rows = run(card({ startDate: "2026-01-05" }, { dueDate: 31 }));
    expect(dates(rows).slice(0, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("due on the 31st, tracking from Apr 10: first bill Apr 30, id of April (not May 31)", () => {
    const rows = run(card({ startDate: "2026-04-10" }, { dueDate: 31 }));
    expect(rows[0].scheduledDate).toBe("2026-04-30");
    expect(rows[0].occurrenceId).toBe("card-1_2026-04");
  });

  it("due on the 29th in a leap year: Feb 29 2028, then Mar 29", () => {
    const rows = run(card({ startDate: "2028-01-30" }, { dueDate: 29 }));
    // Jan 29 is before the Jan 30 start, so the first bill is Feb 29 (2028 is a leap year)
    expect(dates(rows).slice(0, 3)).toEqual(["2028-02-29", "2028-03-29", "2028-04-29"]);
  });

  it("never skips a month from a 29th/30th/31st due date (36 consecutive months)", () => {
    [29, 30, 31].forEach((dueDate) => {
      const rows = run(card({ startDate: "2026-01-01" }, { dueDate, paymentStrategy: "fixed", fixedPaymentAmount: 150 }));
      const months = rows.slice(0, 36).map((t) => t.scheduledDate.slice(0, 7));
      months.forEach((m, i) => {
        const total = 2026 * 12 + i;
        const expected = `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
        expect(m).toBe(expected);
      });
    });
  });

  it("a due day that already passed this month starts next month", () => {
    const rows = run(card({ startDate: "2026-01-20" }, { dueDate: 15 }));
    expect(rows[0].scheduledDate).toBe("2026-02-15");
  });

  it("a blank / NaN / out-of-range due date falls back to the day of the start date (clamped to 1-31)", () => {
    expect(run(card({ startDate: "2026-03-12" }, { dueDate: NaN }))[0].scheduledDate).toBe("2026-03-12");
    expect(run(card({ startDate: "2026-03-12" }, { dueDate: 0 }))[0].scheduledDate).toBe("2026-03-12");
    // 45 is clamped to 31 -> Mar 31
    expect(run(card({ startDate: "2026-03-12" }, { dueDate: 45 }))[0].scheduledDate).toBe("2026-03-31");
  });
});

describe("the window filters on the EMITTED date", () => {
  it("never emits a payment dated after the window end (due 31, window ends Mar 10)", () => {
    const rows = run(card({}, { dueDate: 31 }), d("2026-01-01"), d("2026-03-10"));
    expect(dates(rows)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("includes a payment moved by a weekend shift INTO the window and excludes one moved OUT", () => {
    // due 31: Jan 31 2026 is a Saturday. 'after' -> Mon Feb 2.
    const after = card({ weekendAdjustment: "after" }, { dueDate: 31 });
    expect(dates(run(after, d("2026-01-01"), d("2026-01-31")))).toEqual([]); // moved out of January
    expect(dates(run(after, d("2026-02-01"), d("2026-02-02")))).toEqual(["2026-02-02"]); // moved into Feb 1-2
    // 'before' -> Fri Jan 30, inside a window that ends Jan 30 even though the logical date is Jan 31
    const before = card({ weekendAdjustment: "before" }, { dueDate: 31 });
    expect(dates(run(before, d("2026-01-01"), d("2026-01-30")))).toEqual(["2026-01-30"]);
  });

  it("keeps the occurrence id of the LOGICAL month when the date moves", () => {
    // due 1, Sunday Mar 1 2026, 'before' -> Fri Feb 27 but it is March's bill
    const rows = run(card({ startDate: "2026-03-01", weekendAdjustment: "before" }, { dueDate: 1 }));
    expect(rows[0].scheduledDate).toBe("2026-02-27");
    expect(rows[0].occurrenceId).toBe("card-1_2026-03");
  });

  it("applies the weekend adjustment: due on Sat Feb 7 with 'after' bills Mon Feb 9 (UI-RULE-48)", () => {
    const rows = run(card({ startDate: "2026-02-01", weekendAdjustment: "after" }, { dueDate: 7 }));
    expect(rows[0].scheduledDate).toBe("2026-02-09");
  });
});

describe("full_balance clears the card in one payment", () => {
  it("emits exactly one bill of the balance, with zero interest and nothing remaining (UI-RULE-41)", () => {
    const rows = run(card({}, { paymentStrategy: "full_balance" }));
    expect(rows).toHaveLength(1);
    expect(rows[0].projectedAmount).toBe(5_000);
    expect(rows[0].scheduledDate).toBe("2026-01-15");
    expect(rows[0].paymentBreakdown).toMatchObject({
      principalPaid: 5_000,
      interestPaid: 0,
      remainingBalance: 0,
      paymentNumber: 1,
      totalPayments: 1,
    });
  });
});

describe("paymentNumber and totalPayments", () => {
  it("totalPayments is the length of the payoff schedule: 1,200 @ 0% paying 300 = 4", () => {
    const rows = run(card({}, { currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 }));
    expect(rows.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([1, 2, 3, 4]);
    expect(rows.map((t) => t.paymentBreakdown!.totalPayments)).toEqual([4, 4, 4, 4]);
  });

  it("totalPayments does not depend on the window", () => {
    const rows = run(card({}, { currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 }), d("2026-03-01"), d("2026-03-31"));
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentBreakdown).toMatchObject({ paymentNumber: 3, totalPayments: 4 });
  });

  it("totalPayments is 0 (no known end) for a card that never pays off", () => {
    // 5,000 @ 24% paying 50 compounds for ever
    const rows = run(card({}, { fixedPaymentAmount: 50 }), d("2026-01-01"), d("2026-06-30"));
    expect(rows).toHaveLength(6);
    rows.forEach((t) => expect(t.paymentBreakdown!.totalPayments).toBe(0));
  });
});

describe("a trapped card keeps billing for as long as the window asks", () => {
  it("2% minimum against 2%/month: a bill every month for 24 months, flat 5,000 balance", () => {
    const rows = run(
      card({}, { paymentStrategy: "minimum", minimumPaymentPercent: 2, minimumPaymentFloor: 25, minimumPaymentMethod: "percent_only" }),
      d("2026-01-01"),
      d("2027-12-31")
    );
    expect(rows).toHaveLength(24);
    rows.forEach((t) => expect(t.paymentBreakdown!.remainingBalance).toBeCloseTo(5_000, 6));
  });

  it("a payment of 50 (below the 100 interest) shows the balance compounding in the breakdown", () => {
    const rows = run(card({}, { fixedPaymentAmount: 50 }), d("2026-01-01"), d("2026-03-31"));
    // 5,000 -> 5,050.00 -> 5,101.00 -> 5,153.02
    expect(rows.map((t) => t.paymentBreakdown!.remainingBalance)).toEqual([
      expect.closeTo(5_050, 9),
      expect.closeTo(5_101, 9),
      expect.closeTo(5_153.02, 9),
    ]);
    // amount = payment = 50 even though principal is negative
    rows.forEach((t) => expect(t.projectedAmount).toBeCloseTo(50, 9));
  });
});

describe("a card that pays off conserves money end to end", () => {
  const rows = run(card({}));

  it("principal sums to the opening balance and the last bill leaves 0", () => {
    const principal = rows.reduce((sum, t) => sum + t.paymentBreakdown!.principalPaid, 0);
    expect(principal).toBeCloseTo(5_000, 6);
    expect(rows[rows.length - 1].paymentBreakdown!.remainingBalance).toBe(0);
  });

  it("remaining = opening + interest - paid at every row (5,000 @ 24%, 500/month = 12 bills)", () => {
    expect(rows).toHaveLength(12);
    let interest = 0;
    let paid = 0;
    rows.forEach((t) => {
      interest += t.paymentBreakdown!.interestPaid;
      paid += t.projectedAmount;
      expect(t.paymentBreakdown!.remainingBalance).toBeCloseTo(5_000 + interest - paid, 6);
    });
  });
});

describe("blank or NaN optional inputs never produce NaN bills", () => {
  it("a blank minimum percent (NaN) falls back to the floor: a finite 25.00 bill (UI-RULE-45)", () => {
    const rows = run(
      card({}, { paymentStrategy: "minimum", minimumPaymentPercent: NaN, minimumPaymentFloor: 25 }),
      d("2026-01-01"),
      d("2026-06-30")
    );
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((t) => {
      expect(Number.isFinite(t.projectedAmount)).toBe(true);
      expect(t.projectedAmount).toBeGreaterThan(0);
    });
    expect(rows[0].projectedAmount).toBeCloseTo(25, 9);
  });

  it("with BOTH percent and floor blank there is no payment to bill: nothing is emitted rather than NaN or 0 bills", () => {
    const rows = run(card({}, { paymentStrategy: "minimum", minimumPaymentPercent: NaN, minimumPaymentFloor: NaN }));
    expect(rows).toEqual([]);
  });

  it("a NaN balance or NaN APR yields nothing / finite numbers, never NaN", () => {
    expect(run(card({}, { currentBalance: NaN }))).toEqual([]);
    const rows = run(card({}, { apr: NaN, fixedPaymentAmount: 1_000 }));
    expect(rows).toHaveLength(5); // 5,000 at 0% paying 1,000
    rows.forEach((t) => expect(Number.isFinite(t.projectedAmount)).toBe(true));
  });

  it("a missing weekendAdjustment is treated as 'none' (no shift on a Saturday)", () => {
    // Feb 7 2026 is a Saturday
    const rule = card({ startDate: "2026-02-01" }, { dueDate: 7 });
    (rule as { weekendAdjustment?: unknown }).weekendAdjustment = undefined;
    expect(run(rule)[0].scheduledDate).toBe("2026-02-07");
  });
});
