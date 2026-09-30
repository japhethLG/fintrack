import { describe, expect, it } from "vitest";
import { monthlyPaymentDate } from "@/lib/logic/projectionEngine/dateUtils";
import { generateLoanProjections } from "@/lib/logic/projectionEngine/loanProjections";
import { generateInstallmentProjections } from "@/lib/logic/projectionEngine/installmentProjections";
import { formatDate } from "@/lib/utils/dateUtils";
import { makeInstallmentRule, makeLoanRule } from "../../helpers/builders";
import { d } from "../../helpers/dates";

/**
 * UI-RULE-35/36/53: a loan / installment plan's "Day of Month" decides the payment day.
 * Expected dates are hand-listed from the 2026 calendar (not computed with app code).
 */

const at = (start: string, day: unknown, n: number) => formatDate(monthlyPaymentDate(d(start), day, n));
const series = (start: string, day: unknown, count: number) =>
  Array.from({ length: count }, (_, i) => at(start, day, i));

describe("monthlyPaymentDate", () => {
  it("without a usable day it follows the start date's own day (clamped from the fixed anchor)", () => {
    // Jan 31 + 1 = Feb 28, + 2 = Mar 31 (never drifts to the 28th)
    expect(series("2026-01-31", undefined, 3)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(series("2026-02-10", null, 2)).toEqual(["2026-02-10", "2026-03-10"]);
    for (const bad of [0, 32, -3, NaN, "x", ""]) expect(at("2026-02-10", bad, 1)).toBe("2026-03-10");
  });

  it("a day after the start day pays in the start month: start Feb 10, day 20 -> Feb 20, Mar 20, Apr 20", () => {
    expect(series("2026-02-10", 20, 3)).toEqual(["2026-02-20", "2026-03-20", "2026-04-20"]);
  });

  it("a day before the start day starts next month: start Feb 10, day 5 -> Mar 5, Apr 5", () => {
    expect(series("2026-02-10", 5, 2)).toEqual(["2026-03-05", "2026-04-05"]);
  });

  it("the start day itself is the first payment", () => {
    expect(series("2026-02-10", 10, 2)).toEqual(["2026-02-10", "2026-03-10"]);
  });

  it("day 31 clamps each short month from the fixed day: Jan 31, Feb 28, Mar 31, Apr 30", () => {
    expect(series("2026-01-05", 31, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("day 31 with a start in February: Feb 28 (clamped, not before the start) then Mar 31", () => {
    expect(series("2026-02-10", 31, 2)).toEqual(["2026-02-28", "2026-03-31"]);
  });

  it("crosses the year boundary: start Nov 20, day 5 -> Dec 5, Jan 5", () => {
    expect(series("2026-11-20", 5, 2)).toEqual(["2026-12-05", "2027-01-05"]);
  });

  it("accepts the day as a numeric string (legacy documents)", () => {
    expect(series("2026-02-10", "20", 2)).toEqual(["2026-02-20", "2026-03-20"]);
  });
});

describe("loan projections honour scheduleConfig.dayOfMonth (UI-RULE-35)", () => {
  const WIDE = [d("2025-01-01"), d("2031-12-31")] as const;
  const loan = (scheduleConfig: object) =>
    makeLoanRule(
      { startDate: "2026-02-10", weekendAdjustment: "none", scheduleConfig },
      { principalAmount: 4000, currentBalance: 4000, interestRate: 0, termMonths: 4, monthlyPayment: 1000 }
    );

  it("start Feb 10, Day of Month 20: payments Feb 20, Mar 20, Apr 20, May 20", () => {
    const rows = generateLoanProjections(loan({ dayOfMonth: 20 }), ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20"]);
    expect(rows.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([1, 2, 3, 4]);
  });

  it("no Day of Month: payments stay on the start date's day (Feb 10 ... May 10)", () => {
    const rows = generateLoanProjections(loan({}), ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"]);
  });

  it("with 2 payments made the next one is the 3rd on the chosen day (Apr 20)", () => {
    const rule = loan({ dayOfMonth: 20 });
    rule.loanConfig = { ...rule.loanConfig!, paymentsMade: 2, currentBalance: 2000 };
    const rows = generateLoanProjections(rule, ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-04-20", "2026-05-20"]);
    expect(rows[0].paymentBreakdown!.paymentNumber).toBe(3);
  });

  it("the weekend adjustment still applies on top (Sat Feb 7 -> Mon Feb 9 'after')", () => {
    const rule = { ...loan({ dayOfMonth: 7 }), startDate: "2026-02-01", weekendAdjustment: "after" as const };
    const rows = generateLoanProjections(rule, ...WIDE);
    // Feb 7 Sat -> Mon Feb 9; Mar 7 Sat -> Mon Mar 9; Apr 7 Tue; May 7 Thu
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-09", "2026-03-09", "2026-04-07", "2026-05-07"]);
  });
});

describe("installment projections honour scheduleConfig.dayOfMonth (UI-RULE-53)", () => {
  const WIDE = [d("2025-01-01"), d("2031-12-31")] as const;
  const plan = (scheduleConfig: object) =>
    makeInstallmentRule(
      { startDate: "2026-02-10", weekendAdjustment: "none", scheduleConfig },
      { totalAmount: 400, installmentCount: 4, installmentAmount: 100, installmentsPaid: 0 }
    );

  it("start Feb 10, Day of Month 20: Feb 20, Mar 20, Apr 20, May 20", () => {
    const rows = generateInstallmentProjections(plan({ dayOfMonth: 20 }), ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-20", "2026-03-20", "2026-04-20", "2026-05-20"]);
  });

  it("day 31 from a Jan 5 start: Jan 31, Feb 28, Mar 31, Apr 30", () => {
    const rule = { ...plan({ dayOfMonth: 31 }), startDate: "2026-01-05" };
    const rows = generateInstallmentProjections(rule, ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("no Day of Month: unchanged (Feb 10 ... May 10)", () => {
    const rows = generateInstallmentProjections(plan({}), ...WIDE);
    expect(rows.map((t) => t.scheduledDate)).toEqual(["2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"]);
  });
});
