import { describe, expect, it } from "vitest";

import {
  annualRecurringTotals,
  isExpenseRuleCurrent,
  isIncomeSourceCurrent,
  monthBounds,
  plannedTotals,
  recurringPeriodTotals,
  installmentRemaining,
  totalDebt,
} from "@/lib/logic/forecasting/recurringTotals";
import { getMonthlyMultiplier, prorateToDateRange } from "@/lib/utils/frequencyUtils";
import {
  makeCompletedTransaction,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
  makeManualTransaction,
  makeProjectedTransaction,
  makeSkippedTransaction,
} from "../../helpers/builders";

/**
 * THEME: monthly and yearly totals are COUNTED from occurrences, never estimated as
 * amount x multiplier. Hand-derived values; `today` is explicit.
 */

describe("which sources and rules are current (and so 'Active')", () => {
  const TODAY = "2026-03-16";

  it("an income source past its end date, or switched off, is not current", () => {
    expect(isIncomeSourceCurrent(makeIncomeSource({}), TODAY)).toBe(true);
    expect(isIncomeSourceCurrent(makeIncomeSource({ endDate: "2026-03-16" }), TODAY)).toBe(true); // ends today
    expect(isIncomeSourceCurrent(makeIncomeSource({ endDate: "2026-03-15" }), TODAY)).toBe(false);
    expect(isIncomeSourceCurrent(makeIncomeSource({ isActive: false }), TODAY)).toBe(false);
  });

  it("an expense rule is current until it ends, is repaid, settled or fully paid", () => {
    expect(isExpenseRuleCurrent(makeExpenseRule({}), TODAY)).toBe(true);
    expect(isExpenseRuleCurrent(makeExpenseRule({ endDate: "2026-03-15" }), TODAY)).toBe(false);
    expect(isExpenseRuleCurrent(makeExpenseRule({ isActive: false }), TODAY)).toBe(false);

    expect(isExpenseRuleCurrent(makeLoanRule({}, { currentBalance: 0 }), TODAY)).toBe(false); // repaid
    expect(isExpenseRuleCurrent(makeLoanRule({}, { currentBalance: 0.004 }), TODAY)).toBe(false); // under half a cent
    expect(isExpenseRuleCurrent(makeLoanRule({}, { currentBalance: 6_000 }), TODAY)).toBe(true);

    expect(isExpenseRuleCurrent(makeCreditRule({}, { currentBalance: 0 }), TODAY)).toBe(false); // settled
    expect(isExpenseRuleCurrent(makeCreditRule({}, { currentBalance: 800 }), TODAY)).toBe(true);

    expect(isExpenseRuleCurrent(makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 6 }), TODAY)).toBe(false);
    expect(isExpenseRuleCurrent(makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 5 }), TODAY)).toBe(true);
  });
});

describe("recurringPeriodTotals: the recurring rows of a month", () => {
  const sources = [
    makeIncomeSource({ id: "pay", frequency: "semi-monthly" }),
    makeIncomeSource({ id: "gift", frequency: "one-time" }),
    makeIncomeSource({ id: "ended", endDate: "2026-02-28" }),
  ];
  const rules = [
    makeExpenseRule({ id: "rent", frequency: "monthly" }),
    makeExpenseRule({ id: "dentist", frequency: "one-time", expenseType: "one-time" }),
    makeLoanRule({ id: "loan" }, { currentBalance: 0 }), // repaid
  ];
  const income = (id: string, sourceId: string, date: string, amount: number, extra = {}) =>
    makeProjectedTransaction({ id, sourceType: "income_source", sourceId, type: "income", scheduledDate: date, projectedAmount: amount, ...extra });
  const expense = (id: string, sourceId: string, date: string, amount: number, extra = {}) =>
    makeProjectedTransaction({ id, sourceType: "expense_rule", sourceId, type: "expense", scheduledDate: date, projectedAmount: amount, ...extra });

  const rows = [
    income("p1", "pay", "2026-03-15", 2_000, { status: "completed", actualAmount: 1_950 }), // paid short
    income("p2", "pay", "2026-03-30", 2_000),
    income("g", "gift", "2026-03-20", 500), // one-time: not recurring
    income("e", "ended", "2026-03-01", 3_000), // source ended in February: not current
    expense("r", "rent", "2026-03-01", 1_200),
    expense("d", "dentist", "2026-03-27", 250), // one-time
    expense("l", "loan", "2026-03-20", 565), // repaid loan
    expense("skipped-rent", "rent", "2026-03-02", 999, { status: "skipped" }),
    makeManualTransaction({ id: "m", type: "expense", projectedAmount: 40, scheduledDate: "2026-03-10" }), // manual
    income("next-month", "pay", "2026-04-15", 2_000),
  ];

  it("counts current recurring rows at their actual or plan, and nothing else", () => {
    const totals = recurringPeriodTotals(rows, sources, rules, "2026-03-01", "2026-03-31", "2026-03-16");

    // income: 1,950 (paid) + 2,000 (planned) = 3,950 ; expenses: rent 1,200
    expect(totals).toEqual({ income: 3_950, expenses: 1_200, net: 2_750 });
  });
});

describe("annualRecurringTotals counts the next 12 months' occurrences", () => {
  it("a daily $10 source is 365 payments, not 12 x 30 (UI-DISP-24)", () => {
    // 2026-03-16 .. 2027-03-15 inclusive = 365 days (no leap day in the range)
    const totals = annualRecurringTotals(
      [makeIncomeSource({ id: "d", frequency: "daily", amount: 10, startDate: "2026-01-01" })],
      [],
      "2026-03-16"
    );

    expect(totals.income).toBe(3_650);
  });

  it("a weekly source in a 53-Wednesday year is 53 payments, where the multiplier says 52", () => {
    // 2025-01-01 is a Wednesday; 2025-01-01 .. 2025-12-31 holds 53 Wednesdays (365 = 52 weeks + 1 day)
    const weekly = makeIncomeSource({
      id: "w",
      frequency: "weekly",
      amount: 100,
      startDate: "2025-01-01",
      scheduleConfig: { dayOfWeek: 3 },
    });

    const totals = annualRecurringTotals([weekly], [], "2025-01-01");

    expect(totals.income).toBe(5_300); // 53 x 100
    expect(100 * getMonthlyMultiplier("weekly") * 12).toBeCloseTo(5_200, 6); // the estimate
  });

  it("an ended source and a one-time source contribute nothing", () => {
    const totals = annualRecurringTotals(
      [
        makeIncomeSource({ id: "ended", endDate: "2026-02-28" }),
        makeIncomeSource({ id: "once", frequency: "one-time", startDate: "2026-05-01" }),
      ],
      [],
      "2026-03-16"
    );

    expect(totals).toEqual({ income: 0, expenses: 0, net: 0 });
  });

  it("monthly 3,000 is twelve payments: Apr 1 .. Mar 1 from Mar 16 2026", () => {
    const totals = annualRecurringTotals([makeIncomeSource({ amount: 3_000 })], [], "2026-03-16");

    expect(totals.income).toBe(36_000);
  });
});

describe("plannedTotals: the plan of a period", () => {
  it("is every non-skipped row scheduled in it at its projected amount (a 3,000 salary is 3,000 in a 31-day month)", () => {
    const rows = [
      makeProjectedTransaction({ id: "sal", type: "income", projectedAmount: 3_000, scheduledDate: "2026-01-15" }),
      makeCompletedTransaction({ id: "rent", type: "expense", projectedAmount: 1_200, actualAmount: 1_250, scheduledDate: "2026-01-01" }),
      makeSkippedTransaction({ id: "skip", type: "expense", projectedAmount: 400, scheduledDate: "2026-01-20" }),
      makeProjectedTransaction({ id: "feb", type: "expense", projectedAmount: 9, scheduledDate: "2026-02-01" }),
    ];

    // January (31 days): income 3,000 ; expenses 1,200 (the PLAN, not the 1,250 actual) ; net 1,800
    expect(plannedTotals(rows, "2026-01-01", "2026-01-31")).toEqual({
      income: 3_000,
      expenses: 1_200,
      net: 1_800,
    });
  });
});

describe("totalDebt", () => {
  it("adds loan and card balances and the unpaid instalments (remaining x amount)", () => {
    const rules = [
      makeLoanRule({ id: "loan" }, { currentBalance: 12_000 }),
      makeCreditRule({ id: "card" }, { currentBalance: 1_000 }),
      makeInstallmentRule({ id: "bnpl" }, { installmentCount: 6, installmentsPaid: 2, installmentAmount: 200 }),
      makeExpenseRule({ id: "rent" }),
      makeLoanRule({ id: "off", isActive: false }, { currentBalance: 99_999 }),
    ];

    // 12,000 + 1,000 + (6 - 2) x 200 = 13,800 ; the rent is no debt, the switched-off loan is not counted
    expect(totalDebt(rules)).toBe(13_800);
  });
});

describe("installmentRemaining (MANUAL-L1)", () => {
  const plan = (over: Record<string, unknown> = {}) =>
    makeInstallmentRule(
      {},
      { totalAmount: 25_000, installmentCount: 12, installmentAmount: 2_083.33, installmentsPaid: 0, ...over }
    ).installmentConfig!;

  it("a 25,000 plan over 12 with nothing paid has 25,000 left, not 12 x 2,083.33 = 24,999.96", () => {
    expect(installmentRemaining(plan())).toBe(25_000);
    expect(totalDebt([makeInstallmentRule({}, plan())])).toBe(25_000);
  });

  it("the last installment absorbs the residual: 11 paid leaves 2,083.37", () => {
    expect(installmentRemaining(plan({ installmentsPaid: 11 }))).toBe(2_083.37);
  });

  it("3 paid leaves 9 installments, the last of them 2,083.37: 8 x 2,083.33 + 2,083.37 = 18,750", () => {
    expect(installmentRemaining(plan({ installmentsPaid: 3 }))).toBe(18_750);
  });

  it("a fully paid plan owes nothing", () => {
    expect(installmentRemaining(plan({ installmentsPaid: 12 }))).toBe(0);
  });
});

describe("monthBounds", () => {
  it("returns the first and last day of the month, leap years included", () => {
    expect(monthBounds("2026-03-16")).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(monthBounds("2028-02-10")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });
});

describe("typical-month helpers (not used by any displayed total)", () => {
  it("prorateToDateRange: a whole calendar month is exactly the monthly amount, whatever its length (UI-OBS-01)", () => {
    expect(prorateToDateRange(3_000, "2026-03-01", "2026-03-31")).toBeCloseTo(3_000, 9); // 31 days
    expect(prorateToDateRange(3_000, "2026-02-01", "2026-02-28")).toBeCloseTo(3_000, 9); // 28 days
    expect(prorateToDateRange(3_000, "2026-04-01", "2026-04-30")).toBeCloseTo(3_000, 9); // 30 days
  });

  it("a daily source is a 365-day year in the multiplier: 365 / 12 per month", () => {
    expect(getMonthlyMultiplier("daily") * 12).toBeCloseTo(365, 9);
  });
});
