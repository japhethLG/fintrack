import { describe, expect, it } from "vitest";
import { generateLoanProjections } from "@/lib/logic/projectionEngine/loanProjections";
import { makeLoanRule } from "../helpers/builders";
import { d } from "../helpers/dates";

/**
 * Loan projections: anchor advance, absolute payment numbers, level payments,
 * weekend adjustment, residual reporting and the cent-level invariants.
 * Expected values are hand-derived (comments) or come from the reference maths below.
 */

/** Independent PMT. */
const pmt = (principal: number, monthlyRate: number, months: number): number => {
  if (monthlyRate === 0) return principal / months;
  const g = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * g) / (g - 1);
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const PMT_12K = pmt(12_000, 0.01, 24); // 564.8816667

const WIDE_START = d("2025-01-01");
const WIDE_END = d("2031-12-31");

/**
 * A 12,000 @ 12% / 24-month loan whose stored payment is the exact PMT.
 * `rule` overrides the rule, `cfg` the loan config.
 */
const loan = (rule: Parameters<typeof makeLoanRule>[0] = {}, cfg: Parameters<typeof makeLoanRule>[1] = {}) =>
  makeLoanRule({ startDate: "2026-01-15", ...rule }, { monthlyPayment: PMT_12K, ...cfg });

const project = (r: ReturnType<typeof loan>, start = WIDE_START, end = WIDE_END) =>
  generateLoanProjections(r, start, end);

const breakdown = (t: ReturnType<typeof project>[number]) => t.paymentBreakdown!;

/** Balance after `k` payments of the reference loan, by an independent loop. */
const balanceAfter = (k: number): number => {
  let b = 12_000;
  for (let i = 0; i < k; i++) b = b * 1.01 - PMT_12K;
  return b;
};

describe("anchor advances with paymentsMade", () => {
  it("dates payment k+1 at startDate + k months from the ORIGINAL anchor (Jan 31 anchor, 3 paid -> Apr 30, then May 31)", () => {
    // addMonths(Jan 31, 3) = Apr 30 (April has 30 days); addMonths(Jan 31, 4) = May 31.
    const rows = project(
      loan({ startDate: "2026-01-31" }, { paymentsMade: 3, currentBalance: balanceAfter(3) })
    );
    expect(rows.slice(0, 2).map((t) => t.scheduledDate)).toEqual(["2026-04-30", "2026-05-31"]);
    expect(rows).toHaveLength(21); // 24 - 3 remaining
    expect(rows[rows.length - 1].scheduledDate).toBe("2027-12-31");
  });

  it("numbers the first remaining payment k+1 and the last one = term", () => {
    const rows = project(loan({}, { paymentsMade: 5, currentBalance: balanceAfter(5) }));
    expect(breakdown(rows[0]).paymentNumber).toBe(6);
    expect(breakdown(rows[rows.length - 1]).paymentNumber).toBe(24);
  });

  it("does not regenerate a completed month: no row dated before payment k+1", () => {
    // 4 paid from a Jan 15 anchor: paid months are Jan..Apr, so nothing before May 15.
    const rows = project(loan({}, { paymentsMade: 4, currentBalance: balanceAfter(4) }));
    expect(rows[0].scheduledDate).toBe("2026-05-15");
    expect(rows.every((t) => t.scheduledDate >= "2026-05-15")).toBe(true);
  });
});

describe("paymentNumber is a property of the loan, not of the viewport", () => {
  it("reports the same number for the same payment in every window (Jan 31 anchor)", () => {
    const rule = loan({ startDate: "2026-01-31" });
    const whole = project(rule);
    const byDate = new Map(whole.map((t) => [t.scheduledDate, breakdown(t).paymentNumber]));
    // 2026-06-30 is payment 6 (Jan=1 ... Jun=6); 2027-12-31 is payment 24.
    expect(byDate.get("2026-06-30")).toBe(6);
    expect(byDate.get("2027-12-31")).toBe(24);

    const june = project(rule, d("2026-06-01"), d("2026-06-30"));
    expect(june.map((t) => [t.scheduledDate, breakdown(t).paymentNumber])).toEqual([["2026-06-30", 6]]);
    const last = project(rule, d("2027-12-01"), d("2027-12-31"));
    expect(last.map((t) => [t.scheduledDate, breakdown(t).paymentNumber])).toEqual([["2027-12-31", 24]]);
  });
});

describe("the projected amount is the amortized step payment, not rule.amount", () => {
  it("ignores a stale rule.amount of 1,000: every step pays 564.88 (level), the last is trued up", () => {
    const rows = project(loan({ amount: 1_000 }));
    rows.slice(0, -1).forEach((t) => expect(t.projectedAmount).toBeCloseTo(PMT_12K, 6));
    expect(rows).toHaveLength(24);
  });

  it("stays level while paymentsMade advances, even when currentBalance is stale (inconsistent input)", () => {
    // currentBalance never reduced (12,000 at k = 0..3): the contractual payment must not inflate.
    [0, 1, 2, 3].forEach((k) => {
      const rows = project(loan({}, { paymentsMade: k, currentBalance: 12_000 }));
      expect(rows[0].projectedAmount).toBeCloseTo(PMT_12K, 6);
    });
  });
});

describe("a consistent loan conserves money end to end", () => {
  const rows = project(loan({}));
  const opening = 12_000;

  it("principal sums to the opening balance", () => {
    expect(sum(rows.map((t) => breakdown(t).principalPaid))).toBeCloseTo(opening, 6);
  });

  it("ends at exactly 0", () => {
    expect(breakdown(rows[rows.length - 1]).remainingBalance).toBe(0);
  });

  it("remaining = opening + cumulative interest - cumulative paid at every step", () => {
    let interest = 0;
    let paid = 0;
    rows.forEach((t) => {
      interest += breakdown(t).interestPaid;
      paid += t.projectedAmount;
      expect(breakdown(t).remainingBalance).toBeCloseTo(opening + interest - paid, 2);
    });
  });

  it("a part-way loan resumes from its balance with the same payment and the same end date", () => {
    // After 6 payments, balance b6 = 12000*1.01^6 - PMT*(1.01^6-1)/0.01
    const k = 6;
    const resumed = project(loan({}, { paymentsMade: k, currentBalance: balanceAfter(k) }));
    expect(resumed).toHaveLength(18);
    expect(resumed[0].projectedAmount).toBeCloseTo(PMT_12K, 6);
    expect(resumed[resumed.length - 1].scheduledDate).toBe(rows[rows.length - 1].scheduledDate);
    expect(sum(resumed.map((t) => breakdown(t).principalPaid))).toBeCloseTo(balanceAfter(k), 6);
    expect(breakdown(resumed[resumed.length - 1]).remainingBalance).toBe(0);
  });
});

describe("weekend adjustment on loans", () => {
  // 2026-02-07 is a Saturday, 2026-03-07 a Saturday, 2026-04-07 a Tuesday.
  it("moves a Saturday payment to Monday for 'after', to Friday for 'before', leaves 'none'", () => {
    const after = project(loan({ startDate: "2026-02-07", weekendAdjustment: "after" }));
    expect(after.slice(0, 3).map((t) => t.scheduledDate)).toEqual(["2026-02-09", "2026-03-09", "2026-04-07"]);
    const before = project(loan({ startDate: "2026-02-07", weekendAdjustment: "before" }));
    expect(before.slice(0, 3).map((t) => t.scheduledDate)).toEqual(["2026-02-06", "2026-03-06", "2026-04-07"]);
    const none = project(loan({ startDate: "2026-02-07", weekendAdjustment: "none" }));
    expect(none.slice(0, 2).map((t) => t.scheduledDate)).toEqual(["2026-02-07", "2026-03-07"]);
  });

  it("keeps the occurrence id of the LOGICAL month when the date moves", () => {
    // Sun 2026-03-01 'before' -> Fri 2026-02-27, but it is still March's payment
    const rows = project(loan({ startDate: "2026-03-01", weekendAdjustment: "before" }));
    expect(rows[0].scheduledDate).toBe("2026-02-27");
    expect(rows[0].occurrenceId).toBe("loan-1_2026-03");
  });

  it("filters on the EMITTED date: a payment moved into the window is included, one moved out is not", () => {
    // Sun 2026-03-01 'before' -> Fri 02-27: inside a Feb-only window
    const into = project(loan({ startDate: "2026-03-01", weekendAdjustment: "before" }), d("2026-02-01"), d("2026-02-28"));
    expect(into.map((t) => t.scheduledDate)).toEqual(["2026-02-27"]);
    // Sun 2026-03-01 'after' -> Mon 03-02: outside a window that ends Mar 1
    const out = project(loan({ startDate: "2026-03-01", weekendAdjustment: "after" }), d("2026-03-01"), d("2026-03-01"));
    expect(out).toEqual([]);
  });
});

describe("a loan that is finished, or finished-but-still-owed, is never silently dropped", () => {
  it("returns nothing when the balance is 0, even if fewer than `term` payments were counted (early payoff)", () => {
    expect(project(loan({}, { paymentsMade: 10, currentBalance: 0 }))).toEqual([]);
  });

  it("returns nothing for a fully paid loan (all 24 made, balance 0)", () => {
    expect(project(loan({}, { paymentsMade: 24, currentBalance: 0 }))).toEqual([]);
  });

  it("reports the outstanding balance after the term: 500 owed at 12% -> one payment of 505.00 in month 25", () => {
    // 500 + 1 month of interest (500 x 1% = 5.00) = 505.00, dated payment 25 = startDate + 24 months.
    const rows = project(loan({}, { paymentsMade: 24, currentBalance: 500 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledDate).toBe("2028-01-15");
    expect(rows[0].projectedAmount).toBeCloseTo(505, 9);
    expect(breakdown(rows[0])).toMatchObject({
      principalPaid: 500,
      interestPaid: 5,
      remainingBalance: 0,
      paymentNumber: 25,
    });
  });

  it("reports it when more payments were counted than the term (30 of 24) and money is still owed", () => {
    const rows = project(loan({}, { paymentsMade: 30, currentBalance: 1_000 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledDate).toBe("2028-07-15"); // startDate + 30 months
    expect(rows[0].projectedAmount).toBeCloseTo(1_010, 9);
  });

  it("does not throw or emit Infinity for a zero term or NaN balance", () => {
    expect(project(loan({}, { termMonths: 0 }))).toEqual([]);
    expect(project(loan({}, { currentBalance: NaN }))).toEqual([]);
  });
});

describe("D2 calculation types through the projection", () => {
  const cfg = { principalAmount: 12_000, currentBalance: 12_000, termMonths: 24, interestRate: 12 };

  it("flat_rate: level 620.00, interest 120.00 every month (12,000 x 1%), ends at 0", () => {
    const rows = project(loan({}, { ...cfg, calculationType: "flat_rate", monthlyPayment: 564.88 }));
    expect(rows).toHaveLength(24);
    rows.forEach((t) => {
      expect(t.projectedAmount).toBeCloseTo(620, 9);
      expect(breakdown(t).interestPaid).toBeCloseTo(120, 9);
      expect(breakdown(t).principalPaid).toBeCloseTo(500, 9);
    });
    expect(breakdown(rows[23]).remainingBalance).toBe(0);
    // the stored monthlyPayment (564.88, written when the type was ignored) is NOT used for flat loans
  });

  it("flat_rate after 6 payments keeps charging interest on the ORIGINAL 12,000 (120.00), not on the 9,000 owed", () => {
    // 6 paid x 500 principal -> 9,000 owed; 18 left; principal 9000/18 = 500; interest 12000*1% = 120.
    const rows = project(loan({}, { ...cfg, calculationType: "flat_rate", paymentsMade: 6, currentBalance: 9_000 }));
    expect(rows).toHaveLength(18);
    expect(rows[0].projectedAmount).toBeCloseTo(620, 9);
    expect(breakdown(rows[0]).interestPaid).toBeCloseTo(120, 9);
    expect(breakdown(rows[0]).paymentNumber).toBe(7);
  });

  it("reducing_balance: 620, 615, ... 505 (equal principal 500, interest on the balance)", () => {
    const rows = project(loan({}, { ...cfg, calculationType: "reducing_balance" }));
    expect(rows.map((t) => Math.round(t.projectedAmount * 100) / 100).slice(0, 3)).toEqual([620, 615, 610]);
    expect(rows[23].projectedAmount).toBeCloseTo(505, 9);
    expect(sum(rows.map((t) => breakdown(t).interestPaid))).toBeCloseTo(1_500, 6);
  });

  it("amortized, flat and reducing projections differ from one another", () => {
    const a = project(loan({}, { ...cfg, calculationType: "amortized" }));
    const f = project(loan({}, { ...cfg, calculationType: "flat_rate" }));
    const r = project(loan({}, { ...cfg, calculationType: "reducing_balance" }));
    expect(a).not.toEqual(f);
    expect(a).not.toEqual(r);
    expect(f).not.toEqual(r);
  });
});

describe("month-end first payment", () => {
  it("Jan 31 start: Jan 31, Feb 28, Mar 31, Apr 30 (never Mar 3)", () => {
    const rows = project(loan({ startDate: "2026-01-31" }));
    expect(rows.slice(0, 4).map((t) => t.scheduledDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
});
