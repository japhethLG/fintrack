import { describe, expect, it } from "vitest";
import {
  calculateCreditCardPayment,
  calculateInstallmentAmount,
  calculateLoanPayment,
  calculateLoanPlan,
  type LoanPlanInput,
} from "@/components/pages/expenses/components/ExpenseRuleForm/formHelpers";

/**
 * The loan / card / installment form maths: one plan drives the headline payment,
 * the preview and the total interest (UI-RULE-31/32/33); invalid input is 0, never
 * Infinity or NaN. Expected values are hand-derived (comments).
 */

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

const values = (over: Partial<LoanPlanInput> = {}): LoanPlanInput => ({
  loanPrincipal: "10000",
  loanCurrentBalance: "5000",
  loanInterestRate: "6",
  loanTermMonths: "12",
  loanCalculationType: "amortized",
  startDate: "2026-02-10", // REWRITTEN (the loan has ONE date: the First Payment Date, `startDate`)
  ...over,
});

describe("calculateLoanPlan (a partially paid loan: principal 10,000, balance 5,000, 6%, 12 months)", () => {
  // r = 0.5%/month; PMT(5000, 0.005, 12) = 5000 * 0.005 * 1.005^12 / (1.005^12 - 1)
  //   = 25 * 1.0616778 / 0.0616778 = 430.3321
  const plan = calculateLoanPlan(values())!;

  it("amortizes the CURRENT balance, not the original principal", () => {
    expect(plan.balance).toBe(5_000);
    expect(plan.payment).toBeCloseTo(430.3321, 3);
  });

  it("the headline payment IS the first row of the preview schedule", () => {
    expect(plan.schedule[0].payment).toBeCloseTo(plan.payment, 9);
    // first row: interest 25.00 (5,000 x 0.5%), principal 405.3321
    expect(plan.schedule[0].interest).toBeCloseTo(25, 9);
    expect(plan.schedule[0].principal).toBeCloseTo(405.3321, 3);
  });

  it("total interest is the sum of the schedule's interest column: 12 x 430.3321 - 5,000 = 163.99", () => {
    expect(plan.totalInterest).toBeCloseTo(sum(plan.schedule.map((s) => s.interest)), 9);
    expect(plan.totalInterest).toBeCloseTo(163.99, 2);
    // the old figure used the ORIGINAL principal: 12 x 860.6643 - 10,000 = 327.97
    expect(plan.totalInterest).not.toBeCloseTo(327.97, 0);
  });

  it("the schedule covers the whole term and ends at 0", () => {
    expect(plan.schedule).toHaveLength(12);
    expect(plan.schedule[11].remainingBalance).toBe(0);
  });

  it("an empty current balance means a new loan: the principal is amortized", () => {
    const fresh = calculateLoanPlan(values({ loanCurrentBalance: "" }))!;
    // PMT(10000, 0.005, 12) = 860.6643
    expect(fresh.balance).toBe(10_000);
    expect(fresh.payment).toBeCloseTo(860.6643, 3);
  });
});

describe("calculateLoanPlan by calculation type", () => {
  const base = { loanPrincipal: "12000", loanCurrentBalance: "", loanInterestRate: "12", loanTermMonths: "24" };

  it("flat_rate: 12000/24 + 12000 x 1% = 620.00 and 2,880.00 of interest", () => {
    const plan = calculateLoanPlan(values({ ...base, loanCalculationType: "flat_rate" }))!;
    expect(plan.payment).toBeCloseTo(620, 9);
    expect(plan.totalInterest).toBeCloseTo(2_880, 6);
  });

  it("reducing_balance: first payment 620.00, 1,500.00 of interest", () => {
    const plan = calculateLoanPlan(values({ ...base, loanCalculationType: "reducing_balance" }))!;
    expect(plan.payment).toBeCloseTo(620, 9);
    expect(plan.totalInterest).toBeCloseTo(1_500, 6);
    expect(plan.schedule[23].payment).toBeCloseTo(505, 9);
  });

  it("amortized: PMT 564.8817 and 1,557.16 of interest", () => {
    const plan = calculateLoanPlan(values({ ...base, loanCalculationType: "amortized" }))!;
    expect(plan.payment).toBeCloseTo(564.8817, 4);
    expect(plan.totalInterest).toBeCloseTo(1_557.16, 2);
  });

  it("flat_rate on a part-paid loan charges interest on the ORIGINAL principal (12,000 x 1% = 120), principal 6,000/12 = 500", () => {
    const plan = calculateLoanPlan(
      values({ ...base, loanCurrentBalance: "6000", loanTermMonths: "12", loanCalculationType: "flat_rate" })
    )!;
    expect(plan.payment).toBeCloseTo(620, 9);
    expect(plan.totalInterest).toBeCloseTo(1_440, 6); // 120 x 12
  });
});

describe("invalid loan input is reported as no plan / a 0 payment, never Infinity", () => {
  it("a term of 0 -> null plan and a 0 payment (UI-RULE-39)", () => {
    expect(calculateLoanPlan(values({ loanTermMonths: "0" }))).toBeNull();
    expect(calculateLoanPayment(1_000, 5, 0)).toBe(0);
    expect(Number.isFinite(calculateLoanPayment(1_000, 5, 0))).toBe(true);
  });

  it("blank rate / term / principal -> null", () => {
    expect(calculateLoanPlan(values({ loanInterestRate: "" }))).toBeNull();
    expect(calculateLoanPlan(values({ loanTermMonths: "" }))).toBeNull();
    expect(calculateLoanPlan(values({ loanPrincipal: "", loanCurrentBalance: "" }))).toBeNull();
  });

  it("a 0% loan divides evenly: 1,200 / 12 = 100.00 with 0 interest", () => {
    const plan = calculateLoanPlan(values({ loanPrincipal: "1200", loanCurrentBalance: "", loanInterestRate: "0", loanTermMonths: "12" }))!;
    expect(plan.payment).toBe(100);
    expect(plan.totalInterest).toBe(0);
  });

  it("a bad start date falls back to a valid date", () => {
    const plan = calculateLoanPlan(values({ startDate: "" }))!;
    expect(Number.isNaN(plan.schedule[0].date.getTime())).toBe(false);
  });
});

describe("calculateInstallmentAmount", () => {
  it("1,000 over 7 is 142.86 (whole cents)", () => {
    expect(calculateInstallmentAmount(1_000, 7, false)).toBe(142.86);
  });
  it("1,200 at 10% over 6: 1,200 x 1.10 / 6 = 220.00", () => {
    expect(calculateInstallmentAmount(1_200, 6, true, 10)).toBe(220);
  });
  it("a count of 0, negative or NaN is 0, not Infinity (UI-RULE-54/55)", () => {
    expect(calculateInstallmentAmount(1_000, 0, false)).toBe(0);
    expect(calculateInstallmentAmount(1_000, -3, false)).toBe(0);
    expect(calculateInstallmentAmount(1_000, NaN, false)).toBe(0);
    expect(calculateInstallmentAmount(NaN, 6, false)).toBe(0);
  });
});

describe("calculateCreditCardPayment", () => {
  it("max(floor, 2% of 5,000) = 100.00", () => {
    expect(calculateCreditCardPayment(5_000, 12, 2, 25, "percent_only")).toBe(100);
  });
  it("percent plus interest: 100 + 5,000 x 1% = 150.00", () => {
    expect(calculateCreditCardPayment(5_000, 12, 2, 25, "percent_plus_interest")).toBeCloseTo(150, 9);
  });
  it("blank percent / floor / APR (NaN) never produce NaN (UI-RULE-44/45)", () => {
    expect(calculateCreditCardPayment(5_000, 12, NaN, 25, "percent_only")).toBe(25);
    expect(calculateCreditCardPayment(5_000, 12, NaN, NaN, "percent_only")).toBe(0);
    expect(calculateCreditCardPayment(5_000, NaN, 2, 25, "percent_plus_interest")).toBe(100);
  });
});
