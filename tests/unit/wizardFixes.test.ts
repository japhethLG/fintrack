import { describe, expect, it } from "vitest";
import { categoryLabel } from "@/lib/utils/categoryLabel";
import { weekendAdjustmentLabel, frequencyLabel } from "@/lib/utils/ruleLabels";
import { getSchedulePreview, lastMonthlyPaymentDate } from "@/lib/logic/ruleSchedule";
import {
  calculateLoanPlan,
  getDefaultValues,
  isMinimumPaymentTrap,
  keptLoanPayment,
  previewPaymentCount,
  collectExpenseIssues,
  type ExpenseRuleFormValues,
} from "@/components/pages/expenses/components/ExpenseRuleForm/formHelpers";

/**
 * Pure pieces behind the wizard fixes (MANUAL-M1, M7, L8 and the UX notes). Hand-derived expectations.
 * 2026: Oct 1 Thu, Oct 31 Sat, Nov 1 Sun.
 */

const ymd = (d: Date | null): string | null =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : null;

describe("categoryLabel", () => {
  it("title-cases a code: debt_payment -> Debt Payment, Debt_payment -> Debt Payment", () => {
    expect(categoryLabel("debt_payment")).toBe("Debt Payment");
    expect(categoryLabel("Debt_payment")).toBe("Debt Payment");
    expect(categoryLabel("groceries")).toBe("Groceries");
    expect(categoryLabel("some-other_thing")).toBe("Some Other Thing");
  });
  it("leaves a readable label alone and survives blanks", () => {
    expect(categoryLabel("Salary")).toBe("Salary");
    expect(categoryLabel("")).toBe("");
  });
});

describe("one wording for frequency and weekend handling", () => {
  it("weekend adjustment reads like the select option everywhere", () => {
    expect(weekendAdjustmentLabel("before")).toBe("Pay on Friday if weekend");
    expect(weekendAdjustmentLabel("after")).toBe("Pay on Monday if weekend");
    expect(weekendAdjustmentLabel("none")).toBe("No adjustment");
    expect(weekendAdjustmentLabel(undefined)).toBe("No adjustment");
  });
  it("'Semi-monthly' is hyphenated", () => {
    expect(frequencyLabel("semi-monthly")).toBe("Semi-monthly");
    expect(frequencyLabel("bi-weekly")).toBe("Every 2 weeks");
  });
});

describe("getSchedulePreview exposes the day a moved payment was due", () => {
  it("monthly on Sun Nov 1, 'before': Fri Oct 30 was due Sun Nov 1; Dec 1 did not move", () => {
    const { occurrences } = getSchedulePreview({
      frequency: "monthly",
      startDate: "2026-11-01",
      weekendAdjustment: "before",
      scheduleConfig: { dayOfMonth: 1 },
    });
    expect(occurrences.slice(0, 2).map((o) => [ymd(o.date), ymd(o.logicalDate)])).toEqual([
      ["2026-10-30", "2026-11-01"],
      ["2026-12-01", "2026-12-01"],
    ]);
  });

  it("one-time and daily-with-end-date previews are not empty", () => {
    const one = getSchedulePreview({
      frequency: "one-time",
      startDate: "2026-10-22",
      weekendAdjustment: "none",
      scheduleConfig: {},
    });
    expect(one.dates.map((d) => ymd(d))).toEqual(["2026-10-22"]);
    const daily = getSchedulePreview({
      frequency: "daily",
      startDate: "2026-10-05",
      hasEndDate: true,
      endDate: "2026-10-08",
      weekendAdjustment: "none",
      scheduleConfig: {},
    });
    expect(daily.dates.map((d) => ymd(d))).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
  });
});

describe("lastMonthlyPaymentDate (an installment plan's end date)", () => {
  it("12 payments from Feb 10 2026 end Jan 10 2027", () => {
    expect(ymd(lastMonthlyPaymentDate("2026-02-10", undefined, 12, "none"))).toBe("2027-01-10");
  });
  it("follows the Day of Month and the weekend adjustment like the engine (Jan 31 start, 3 payments: Mar 31)", () => {
    expect(ymd(lastMonthlyPaymentDate("2026-01-31", 31, 3, "none"))).toBe("2026-03-31");
    // Sat 2026-02-07 + 1 month = Sat 2026-03-07 -> Monday when 'after'
    expect(ymd(lastMonthlyPaymentDate("2026-02-07", undefined, 2, "after"))).toBe("2026-03-09");
  });
  it("null for a plan that cannot be described", () => {
    expect(lastMonthlyPaymentDate("", undefined, 12, "none")).toBeNull();
    expect(lastMonthlyPaymentDate("2026-02-10", undefined, 0, "none")).toBeNull();
  });
});

const form = (over: Partial<ExpenseRuleFormValues> = {}): ExpenseRuleFormValues => ({
  ...getDefaultValues({ startDate: "2026-02-10" }),
  ...over,
});

describe("keptLoanPayment (M1)", () => {
  const terms = {
    loanPrincipal: "12000",
    loanCurrentBalance: "11000",
    loanInterestRate: "12",
    loanTermMonths: "24",
    loanCalculationType: "amortized" as const,
  };
  // the stored terms key of those terms: principal|balance|rate|term|type
  const stored = { loanStoredPayment: 564.88, loanStoredTerms: "12000|11000|12|24|amortized" };

  it("returns the stored payment while the terms are unchanged ('12000.0' is the same principal)", () => {
    expect(keptLoanPayment({ ...terms, ...stored })).toBe(564.88);
    expect(keptLoanPayment({ ...terms, loanPrincipal: "12000.0", ...stored })).toBe(564.88);
  });
  it("is undefined once principal, balance, rate, term or type changes, and for a new loan", () => {
    expect(keptLoanPayment({ ...terms, loanPrincipal: "13000", ...stored })).toBeUndefined();
    expect(keptLoanPayment({ ...terms, loanCurrentBalance: "10000", ...stored })).toBeUndefined();
    expect(keptLoanPayment({ ...terms, loanInterestRate: "6", ...stored })).toBeUndefined();
    expect(keptLoanPayment({ ...terms, loanTermMonths: "36", ...stored })).toBeUndefined();
    expect(keptLoanPayment({ ...terms, loanCalculationType: "flat_rate", ...stored })).toBeUndefined();
    expect(keptLoanPayment(terms)).toBeUndefined();
  });
  it("the plan's headline is the kept payment, and its schedule is dated from the First Payment Date", () => {
    const plan = calculateLoanPlan({
      ...terms,
      ...stored,
      startDate: "2026-02-10",
      loanPaymentsMade: 1,
    })!;
    expect(plan.payment).toBe(564.88);
    expect(plan.schedule[0].payment).toBeCloseTo(564.88, 9);
    // payment #2 of the loan (1 made): first payment date + 1 month
    expect(ymd(plan.schedule[0].date)).toBe("2026-03-10");
  });
});

describe("previewPaymentCount (L8)", () => {
  it("'Pay Full Balance' is one payment; a fixed 500 on 1,000 at 0% is two", () => {
    const base = { expenseType: "credit_card" as const, creditBalance: "1000", creditApr: "0", creditDueDate: "20" };
    expect(previewPaymentCount(form({ ...base, creditPaymentStrategy: "full_balance" }))).toBe(1);
    expect(previewPaymentCount(form({ ...base, creditPaymentStrategy: "fixed", creditFixedPayment: "500" }))).toBe(2);
  });
  it("a loan is its remaining schedule; an installment plan its count; a plain rule has no limit", () => {
    expect(
      previewPaymentCount(
        form({ expenseType: "cash_loan", loanPrincipal: "1200", loanInterestRate: "0", loanTermMonths: "12" })
      )
    ).toBe(12);
    expect(previewPaymentCount(form({ expenseType: "installment", installmentCount: "6" }))).toBe(6);
    expect(previewPaymentCount(form({ expenseType: "fixed" }))).toBeUndefined();
  });
});

describe("isMinimumPaymentTrap (the card wizard's warning)", () => {
  const card = { expenseType: "credit_card" as const, creditBalance: "5000" };
  it("a 2% minimum (100) on 5,000 at 24% (100 interest) is a trap; at 12% (50 interest) it is not", () => {
    expect(isMinimumPaymentTrap(form({ ...card, creditApr: "24" }))).toBe(true);
    expect(isMinimumPaymentTrap(form({ ...card, creditApr: "12" }))).toBe(false);
  });
  it("a fixed payment above the interest clears it; an empty balance never warns", () => {
    expect(isMinimumPaymentTrap(form({ ...card, creditApr: "24", creditPaymentStrategy: "fixed", creditFixedPayment: "1000" }))).toBe(false);
    expect(isMinimumPaymentTrap(form({ ...card, creditBalance: "", creditApr: "24" }))).toBe(false);
  });
});

describe("amounts must be above zero, with a message", () => {
  const messages = (over: Partial<ExpenseRuleFormValues>) =>
    collectExpenseIssues(form({ name: "X", ...over })).map((i) => i.message);
  it("0 and -5 are reported for a fixed expense; 5 is fine", () => {
    expect(messages({ expenseType: "fixed", amount: "0" })).toContain("Amount must be greater than 0");
    expect(messages({ expenseType: "fixed", amount: "-5" })).toContain("Amount must be greater than 0");
    expect(messages({ expenseType: "fixed", amount: "5" })).not.toContain("Amount must be greater than 0");
  });
  it("principal, card balance and installment total too", () => {
    expect(messages({ expenseType: "cash_loan", loanPrincipal: "0", loanInterestRate: "5", loanTermMonths: "12" })).toContain(
      "Principal must be greater than 0"
    );
    expect(messages({ expenseType: "credit_card", creditBalance: "0", creditApr: "5" })).toContain(
      "Current balance must be greater than 0"
    );
    expect(messages({ expenseType: "installment", installmentTotal: "-1" })).toContain(
      "Total amount must be greater than 0"
    );
  });
});
