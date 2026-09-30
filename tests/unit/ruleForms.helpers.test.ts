import { describe, expect, it } from "vitest";
import {
  buildExpenseRulePayload,
  calculateRuleAmount,
  collectExpenseIssues,
  expenseRuleToFormValues,
  getDefaultValues,
  getEffectiveFrequency,
  resolveCreditInputs,
  type ExpenseRuleFormValues,
} from "@/components/pages/expenses/components/ExpenseRuleForm/formHelpers";
import {
  buildIncomePayload,
  collectIncomeIssues,
  getDefaultValues as getIncomeDefaults,
  incomeSourceToFormValues,
} from "@/components/pages/income/components/IncomeSourceForm/formHelpers";
import { makeCreditRule, makeExpenseRule, makeIncomeSource, makeInstallmentRule, makeLoanRule } from "../helpers/builders";

/**
 * The forms' pure halves: default values, validation, and the document a wizard saves.
 * Expected values are hand-derived (comments). "Today" never appears: defaults come from the start date.
 */

const expenseValues = (over: Partial<ExpenseRuleFormValues> = {}): ExpenseRuleFormValues => ({
  ...getDefaultValues({ startDate: "2026-03-06" }),
  name: "Thing",
  amount: "100",
  ...over,
});

describe("defaults come from the start date, never from today", () => {
  it("expense: Fri Mar 6 -> dayOfMonth 6, dayOfWeek 5", () => {
    const v = getDefaultValues({ startDate: "2026-03-06" });
    expect(v.dayOfMonth).toBe(6);
    expect(v.dayOfWeek).toBe(5);
  });
  it("income: Sat Jan 31 -> dayOfMonth 31, dayOfWeek 6", () => {
    const v = getIncomeDefaults({ startDate: "2026-01-31" });
    expect(v.dayOfMonth).toBe(31);
    expect(v.dayOfWeek).toBe(6);
  });
  it("a stored dayOfWeek of 0 (Sunday) is a real value, not 'absent'", () => {
    expect(getDefaultValues({ startDate: "2026-03-06", dayOfWeek: 0 }).dayOfWeek).toBe(0);
  });
  it("a rule with no stored day loads with no day, so the form derives it from the start date", () => {
    const legacy = makeExpenseRule({ frequency: "weekly", startDate: "2026-02-02", scheduleConfig: {} });
    const initial = expenseRuleToFormValues(legacy);
    expect(initial.dayOfWeek).toBeUndefined();
    expect(getDefaultValues(initial).dayOfWeek).toBe(1); // Mon Feb 2
  });
});

describe("expense payload", () => {
  it("monthly: dayOfMonth is persisted as a number even when typed ('31')", () => {
    const p = buildExpenseRulePayload(expenseValues({ frequency: "monthly", dayOfMonth: "31" }));
    expect(p.scheduleConfig).toEqual({ dayOfMonth: 31 });
  });

  it("one-time persists frequency one-time and NO schedule values (UI-RULE-22)", () => {
    const p = buildExpenseRulePayload(expenseValues({ expenseType: "one-time", frequency: "monthly", dayOfMonth: 15 }));
    expect(p.frequency).toBe("one-time");
    expect(p.scheduleConfig).toEqual({});
  });

  it("loans, cards and installments are always monthly whatever the frequency field held", () => {
    for (const expenseType of ["cash_loan", "credit_card", "installment"] as const) {
      expect(getEffectiveFrequency({ expenseType, frequency: "weekly" })).toBe("monthly");
    }
  });

  it("an unticked 'Set End Date', and a ticked one with no date, save endDate undefined", () => {
    expect(buildExpenseRulePayload(expenseValues({ hasEndDate: false, endDate: "2026-09-01" })).endDate).toBeUndefined();
    expect(buildExpenseRulePayload(expenseValues({ hasEndDate: true, endDate: "" })).endDate).toBeUndefined();
    expect(buildExpenseRulePayload(expenseValues({ hasEndDate: true, endDate: "2026-09-01" })).endDate).toBe("2026-09-01");
  });

  it("notes are trimmed, and blank notes are undefined (so an edit clears them)", () => {
    expect(buildExpenseRulePayload(expenseValues({ notes: "  hi " })).notes).toBe("hi");
    expect(buildExpenseRulePayload(expenseValues({ notes: "   " })).notes).toBeUndefined();
  });

  it("an edit carries isActive, paymentsMade and installmentsPaid from the stored rule", () => {
    const loan = makeLoanRule({ isActive: false }, { paymentsMade: 5 });
    const p = buildExpenseRulePayload({ ...getDefaultValues(expenseRuleToFormValues(loan)) });
    expect(p.isActive).toBe(false);
    expect(p.loanConfig?.paymentsMade).toBe(5);
    const plan = makeInstallmentRule({}, { installmentsPaid: 3 });
    const q = buildExpenseRulePayload(getDefaultValues(expenseRuleToFormValues(plan)));
    expect(q.installmentConfig?.installmentsPaid).toBe(3);
  });

  it("an edit of a loan in progress re-derives the payment over the REMAINING term (renaming must not change it)", () => {
    // 12,000 at 12% over 24 months: PMT = 564.8816667; after 5 payments the balance is 12,000*1.01^5 - PMT*(1.01^5-1)/0.01
    // = 12,000 * 1.0510100501 - 564.8816667 * 5.10100501 = 12,612.120601 - 2,881.5...; amortizing THAT over 19 months gives PMT again
    const pmt = (12_000 * 0.01 * Math.pow(1.01, 24)) / (Math.pow(1.01, 24) - 1);
    const balance = 12_000 * Math.pow(1.01, 5) - (pmt * (Math.pow(1.01, 5) - 1)) / 0.01;
    const loan = makeLoanRule(
      { amount: pmt },
      { principalAmount: 12_000, currentBalance: balance, interestRate: 12, termMonths: 24, monthlyPayment: pmt, paymentsMade: 5 }
    );
    const p = buildExpenseRulePayload(getDefaultValues(expenseRuleToFormValues(loan)));
    expect(p.amount).toBeCloseTo(pmt, 6);
    expect(p.loanConfig?.monthlyPayment).toBeCloseTo(pmt, 6);
  });
});

describe("credit card: blank optional fields become documented defaults, never NaN (UI-RULE-42/44/45)", () => {
  const card = (over: Partial<ExpenseRuleFormValues>) =>
    expenseValues({
      expenseType: "credit_card",
      creditBalance: "5000",
      creditApr: "12",
      creditLimit: "",
      creditMinPaymentPercent: "",
      creditMinPaymentFloor: "",
      creditStatementDate: "",
      creditDueDate: "20",
      ...over,
    });

  it("resolveCreditInputs: limit 0 (none), 2%, floor 25, statement day 5", () => {
    expect(resolveCreditInputs(card({}))).toMatchObject({
      creditLimit: 0,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: 25,
      statementDate: 5,
      dueDate: 20,
    });
  });

  it("the saved amount is the 2% minimum: max(25, 2% x 5,000 = 100) = 100, and nothing is NaN", () => {
    expect(calculateRuleAmount(card({}))).toBe(100);
    const p = buildExpenseRulePayload(card({}));
    expect(p.amount).toBe(100);
    expect(JSON.stringify(p)).not.toMatch(/NaN|null/);
    expect(p.creditConfig).toMatchObject({ creditLimit: 0, minimumPaymentPercent: 2, minimumPaymentFloor: 25, statementDate: 5, dueDate: 20 });
    expect(p.scheduleConfig).toEqual({ dayOfMonth: 20 }); // a card pays on its due date
  });

  it("an explicit 0 floor is kept (0 is a value, not blank)", () => {
    expect(resolveCreditInputs(card({ creditMinPaymentFloor: "0" })).minimumPaymentFloor).toBe(0);
  });

  it("fixed and full-balance strategies", () => {
    expect(calculateRuleAmount(card({ creditPaymentStrategy: "fixed", creditFixedPayment: "300" }))).toBe(300);
    expect(calculateRuleAmount(card({ creditPaymentStrategy: "full_balance" }))).toBe(5000);
  });

  it("a card rule from a stored config round-trips (credit limit 0 shows blank again)", () => {
    const stored = makeCreditRule({}, { creditLimit: 0 });
    const initial = expenseRuleToFormValues(stored);
    expect(initial.creditLimit).toBe(""); // 0 means "none given"
  });
});

describe("collectExpenseIssues: what blocks saving", () => {
  const messages = (v: ExpenseRuleFormValues) => collectExpenseIssues(v).map((i) => i.message);

  it("a valid fixed monthly expense has no issues", () => {
    expect(messages(expenseValues())).toEqual([]);
  });

  it("loan: term 0 or fractional, negative rate, negative balance", () => {
    const loan = (over: Partial<ExpenseRuleFormValues>) =>
      expenseValues({ expenseType: "cash_loan", loanPrincipal: "1000", loanInterestRate: "5", loanTermMonths: "12", ...over });
    expect(messages(loan({}))).toEqual([]);
    expect(messages(loan({ loanTermMonths: "0" }))).toEqual(["Term must be a whole number of months, at least 1"]);
    expect(messages(loan({ loanTermMonths: "-3" }))).toEqual(["Term must be a whole number of months, at least 1"]);
    expect(messages(loan({ loanTermMonths: "12.5" }))).toEqual(["Term must be a whole number of months, at least 1"]);
    expect(messages(loan({ loanInterestRate: "-5" }))).toEqual(["Interest rate cannot be negative"]);
    expect(messages(loan({ loanInterestRate: "0" }))).toEqual([]);
    expect(messages(loan({ loanCurrentBalance: "-1" }))).toEqual(["Current balance cannot be negative"]);
  });

  it("installment: count 0, negative, fractional, above 120", () => {
    const plan = (count: string) =>
      expenseValues({ expenseType: "installment", installmentTotal: "1000", installmentCount: count });
    expect(messages(plan("12"))).toEqual([]);
    expect(messages(plan("0"))).toEqual(["Number of installments must be a whole number, at least 1"]);
    expect(messages(plan("-3"))).toEqual(["Number of installments must be a whole number, at least 1"]);
    expect(messages(plan("2.5"))).toEqual(["Number of installments must be a whole number, at least 1"]);
    expect(messages(plan("121"))).toEqual(["Number of installments cannot exceed 120"]);
  });

  it("card: percent above 100, due date or statement date outside 1-31, missing due date, fixed payment 0", () => {
    const card = (over: Partial<ExpenseRuleFormValues>) =>
      expenseValues({ expenseType: "credit_card", creditBalance: "5000", creditApr: "12", ...over });
    expect(messages(card({}))).toEqual([]);
    expect(messages(card({ creditMinPaymentPercent: "150" }))).toEqual(["Percentage cannot exceed 100%"]);
    expect(messages(card({ creditDueDate: "32" }))).toEqual(["Day must be between 1 and 31"]);
    expect(messages(card({ creditDueDate: "0" }))).toEqual(["Day must be between 1 and 31"]);
    expect(messages(card({ creditStatementDate: "40" }))).toEqual(["Day must be between 1 and 31"]);
    expect(messages(card({ creditDueDate: "" }))).toEqual(["Due date is required"]);
    expect(messages(card({ creditPaymentStrategy: "fixed", creditFixedPayment: "0" }))).toEqual([
      "Enter a fixed payment amount greater than 0",
    ]);
    expect(messages(card({ creditApr: "-1" }))).toEqual(["Interest rate cannot be negative"]);
  });

  it("schedule issues are included: end before start, semi-monthly with no days", () => {
    expect(messages(expenseValues({ hasEndDate: true, endDate: "2026-01-01" }))).toEqual([
      "The end date must be on or after the start date.",
    ]);
    expect(messages(expenseValues({ frequency: "semi-monthly", specificDays: [] }))).toEqual([
      "Add at least one day of the month for a semi-monthly schedule.",
    ]);
  });

  it("a one-time expense ignores the stale frequency field (semi-monthly with no days does not block it)", () => {
    expect(messages(expenseValues({ expenseType: "one-time", frequency: "semi-monthly", specificDays: [] }))).toEqual([]);
  });
});

describe("income payload and issues", () => {
  const values = (over = {}) => ({ ...getIncomeDefaults({ startDate: "2026-03-06" }), name: "Pay", amount: "100", ...over });

  it("persists numbers, no stray keys, and no empty end date", () => {
    const p = buildIncomePayload({ ...values(), frequency: "monthly", dayOfMonth: "31", hasEndDate: true, endDate: "" });
    expect(p.scheduleConfig).toEqual({ dayOfMonth: 31 });
    expect(p.endDate).toBeUndefined();
    expect(buildIncomePayload({ ...values(), frequency: "one-time" }).scheduleConfig).toEqual({});
  });

  it("an edit keeps the stored isActive and monthOfYear", () => {
    const stored = makeIncomeSource({ isActive: false, frequency: "yearly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1, monthOfYear: 6 } });
    const p = buildIncomePayload(getIncomeDefaults(incomeSourceToFormValues(stored)));
    expect(p.isActive).toBe(false);
    expect(p.scheduleConfig).toEqual({ dayOfMonth: 1, monthOfYear: 6 });
  });

  it("issues: end before start, semi-monthly with no days, bad amount", () => {
    expect(collectIncomeIssues({ ...values(), hasEndDate: true, endDate: "2026-01-01" }).map((i) => i.field)).toEqual(["endDate"]);
    expect(collectIncomeIssues({ ...values(), frequency: "semi-monthly", specificDays: [] }).map((i) => i.field)).toEqual(["specificDays"]);
    expect(collectIncomeIssues({ ...values(), amount: "0" }).map((i) => i.field)).toEqual(["amount"]);
    expect(collectIncomeIssues(values())).toEqual([]);
  });
});
