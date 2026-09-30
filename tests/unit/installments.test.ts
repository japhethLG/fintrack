import { describe, expect, it } from "vitest";
import { generateInstallmentProjections } from "@/lib/logic/projectionEngine/installmentProjections";
import { makeInstallmentRule } from "../helpers/builders";
import { d, duplicates } from "../helpers/dates";

/**
 * Installment projections: month-end anchor, unique ids, exact totals, guards.
 * Expected values are hand-derived (comments).
 */

const WIDE_START = d("2025-01-01");
const WIDE_END = d("2031-12-31");

const plan = (
  rule: Parameters<typeof makeInstallmentRule>[0] = {},
  cfg: Parameters<typeof makeInstallmentRule>[1] = {}
) => makeInstallmentRule({ startDate: "2026-01-10", ...rule }, cfg);

const run = (r: ReturnType<typeof plan>, start = WIDE_START, end = WIDE_END) =>
  generateInstallmentProjections(r, start, end);

const cents = (x: number): number => Math.round(x * 100);

describe("installments step from the fixed anchor (no drift after February)", () => {
  it("Jan 31 start, 6 installments: Jan 31, Feb 28, Mar 31, Apr 30, May 31, Jun 30 (UI-RULE-52)", () => {
    // From Jan 31: +1 month = Feb 28 (2026 is not a leap year), +2 = Mar 31, +3 = Apr 30, +4 = May 31, +5 = Jun 30.
    expect(run(plan({ startDate: "2026-01-31" })).map((t) => t.scheduledDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("resumes after 2 paid from the ORIGINAL anchor: next is Mar 31, not Mar 28", () => {
    const rows = run(plan({ startDate: "2026-01-31" }, { installmentsPaid: 2 }));
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30"]);
    expect(rows[0].paymentBreakdown!.paymentNumber).toBe(3);
  });

  it("never skips or repeats a month from a 29th/30th/31st anchor over 24 installments", () => {
    ["2026-01-29", "2026-01-30", "2026-01-31", "2027-08-31"].forEach((startDate) => {
      const rows = run(plan({ startDate }, { installmentCount: 24, installmentAmount: 50, totalAmount: 1_200 }));
      expect(rows).toHaveLength(24);
      const [y0, m0] = startDate.split("-").map(Number);
      rows.forEach((t, i) => {
        const monthIndex = y0 * 12 + (m0 - 1) + i;
        const y = Math.floor(monthIndex / 12);
        const m = monthIndex % 12;
        expect(t.scheduledDate.slice(0, 7)).toBe(`${y}-${String(m + 1).padStart(2, "0")}`);
      });
    });
  });
});

describe("occurrence ids are unique per installment", () => {
  it("a month-end start with weekend adjustment 'after' has six distinct ids, one per LOGICAL month", () => {
    // Sat Jan 31 2026 + 'after' -> Mon Feb 2; the id still names January.
    const rows = run(plan({ startDate: "2026-01-31", weekendAdjustment: "after" }));
    expect(rows).toHaveLength(6);
    expect(duplicates(rows.map((t) => t.occurrenceId))).toEqual([]);
    expect(rows.map((t) => t.occurrenceId)).toEqual([
      "inst-1_2026-01",
      "inst-1_2026-02",
      "inst-1_2026-03",
      "inst-1_2026-04",
      "inst-1_2026-05",
      "inst-1_2026-06",
    ]);
    expect(rows[0].scheduledDate).toBe("2026-02-02");
  });

  it("a one-time-frequency plan gets a distinct monthly id per installment, not <id>_once for all", () => {
    const rows = run(plan({ frequency: "one-time" }));
    expect(rows).toHaveLength(6);
    expect(duplicates(rows.map((t) => t.occurrenceId))).toEqual([]);
    expect(rows[0].occurrenceId).toBe("inst-1_2026-01");
    expect(rows[5].occurrenceId).toBe("inst-1_2026-06");
  });
});

describe("exact totals: the final installment absorbs the rounding residual", () => {
  it("1,000 over 7 (stored 142.86): six bills of 142.86 and a last bill of 142.84 = 1,000.00", () => {
    // 142.86 x 6 = 857.16; 1,000.00 - 857.16 = 142.84
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: 142.86 }));
    expect(rows.map((t) => t.projectedAmount)).toEqual([142.86, 142.86, 142.86, 142.86, 142.86, 142.86, 142.84]);
    expect(cents(rows.reduce((s, t) => s + t.projectedAmount, 0))).toBe(100_000);
  });

  it("the same plan stored with the unrounded legacy amount (1000/7 = 142.857142857...) gives the same whole-cent bills", () => {
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: 1_000 / 7 }));
    expect(rows.map((t) => t.projectedAmount)).toEqual([142.86, 142.86, 142.86, 142.86, 142.86, 142.86, 142.84]);
  });

  it("the remaining balance is exact cents and ends at 0: 857.14, 714.28, 571.42, 428.56, 285.70, 142.84, 0", () => {
    // 1,000 - 142.86 = 857.14; - 142.86 = 714.28; 571.42; 428.56; 285.70; 142.84; 0.00
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: 142.86 }));
    expect(rows.map((t) => t.paymentBreakdown!.remainingBalance)).toEqual([857.14, 714.28, 571.42, 428.56, 285.7, 142.84, 0]);
  });

  it("amounts and breakdown agree: principalPaid equals the bill, interestPaid 0 (0% plan)", () => {
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: 142.86 }));
    rows.forEach((t) => {
      expect(t.paymentBreakdown!.principalPaid).toBe(t.projectedAmount);
      expect(t.paymentBreakdown!.interestPaid).toBe(0);
    });
  });

  it("a clean plan is unchanged: 1,200 / 6 x 200", () => {
    const rows = run(plan());
    expect(rows.map((t) => t.projectedAmount)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(rows.map((t) => t.paymentBreakdown!.remainingBalance)).toEqual([1_000, 800, 600, 400, 200, 0]);
  });

  it("resuming after paid installments keeps the same bills and balances (2 paid of the 1,000/7 plan)", () => {
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: 142.86, installmentsPaid: 2 }));
    expect(rows.map((t) => t.projectedAmount)).toEqual([142.86, 142.86, 142.86, 142.86, 142.84]);
    expect(rows.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([3, 4, 5, 6, 7]);
    expect(rows.map((t) => t.paymentBreakdown!.remainingBalance)).toEqual([571.42, 428.56, 285.7, 142.84, 0]);
  });

  it("an amount that disagrees with the total by more than rounding is trusted as stated (no negative last bill)", () => {
    // 6 x 250 = 1,500 against a stated 1,200 total: not a rounding residual, so no true-up
    const rows = run(plan({}, { totalAmount: 1_200, installmentCount: 6, installmentAmount: 250 }));
    expect(rows.map((t) => t.projectedAmount)).toEqual([250, 250, 250, 250, 250, 250]);
  });
});

describe("invalid counts never yield Infinity, NaN or a negative plan", () => {
  it("installmentCount 0 -> nothing (was Infinity per installment)", () => {
    expect(run(plan({}, { installmentCount: 0, installmentAmount: Infinity }))).toEqual([]);
  });

  it("negative or NaN count -> nothing", () => {
    expect(run(plan({}, { installmentCount: -3 }))).toEqual([]);
    expect(run(plan({}, { installmentCount: NaN }))).toEqual([]);
  });

  it("a NaN or zero installmentAmount falls back to total / count in whole cents", () => {
    const rows = run(plan({}, { totalAmount: 1_000, installmentCount: 7, installmentAmount: NaN }));
    expect(rows.map((t) => t.projectedAmount)).toEqual([142.86, 142.86, 142.86, 142.86, 142.86, 142.86, 142.84]);
  });

  it("more installments paid than the count -> nothing", () => {
    expect(run(plan({}, { installmentsPaid: 9 }))).toEqual([]);
  });

  it("a negative paid counter is treated as 0", () => {
    expect(run(plan({}, { installmentsPaid: -2 }))).toHaveLength(6);
  });
});

describe("window filtering is on the emitted date", () => {
  it("a Sunday installment moved to Monday by 'after' is included in a window that starts on that Monday", () => {
    // Sun Feb 1 2026 -> Mon Feb 2
    const rule = plan({ startDate: "2026-02-01", weekendAdjustment: "after" });
    expect(run(rule, d("2026-02-02"), d("2026-02-02")).map((t) => t.scheduledDate)).toEqual(["2026-02-02"]);
    expect(run(rule, d("2026-02-01"), d("2026-02-01"))).toEqual([]);
  });
});
