import { describe, it, expect } from "vitest";

import { generateInstallmentProjections } from "@/lib/logic/projectionEngine/installmentProjections";
import { generateProjections } from "@/lib/logic/projectionEngine/projectionGenerator";
import type { Transaction } from "@/lib/types";

import {
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanRule,
} from "../../helpers/builders";
import { d, duplicates, weekday } from "../../helpers/dates";

/**
 * Installment (BNPL) projections + the top-level projection orchestrator.
 *
 * Sources under test:
 *   app/lib/logic/projectionEngine/installmentProjections.ts
 *   app/lib/logic/projectionEngine/projectionGenerator.ts
 */

type Projected = Omit<Transaction, "id" | "userId" | "createdAt" | "updatedAt">;

/**
 * Local helpers. The shared `ymdAll` works on Date[]; projections carry
 * `scheduledDate` as a "YYYY-MM-DD" string, so these read the string fields
 * straight off the emitted rows without round-tripping through the engine's
 * own dayjs formatting.
 */
const datesOf = (rows: Projected[]): string[] => rows.map((row) => row.scheduledDate);
const occurrenceIdsOf = (rows: Projected[]): string[] => rows.map((row) => row.occurrenceId ?? "");
const amountsOf = (rows: Projected[]): number[] => rows.map((row) => row.projectedAmount);
const sourceIdsOf = (rows: Projected[]): string[] => rows.map((row) => row.sourceId ?? "");
/** Payment breakdowns, asserting presence so a missing one fails loudly. */
const breakdownsOf = (rows: Projected[]) =>
  rows.map((row) => {
    if (!row.paymentBreakdown) throw new Error(`row ${row.scheduledDate} has no paymentBreakdown`);
    return row.paymentBreakdown;
  });

// A window wide enough to contain any 6-month plan used below.
const WIDE_START = d("2026-01-01");
const WIDE_END = d("2027-01-01");

describe("generateInstallmentProjections", () => {
  describe("guard conditions", () => {
    it("returns nothing when the rule has no installment configuration", () => {
      const rule = makeExpenseRule({ expenseType: "installment", installmentConfig: undefined });

      expect(generateInstallmentProjections(rule, WIDE_START, WIDE_END)).toEqual([]);
    });

    it("returns nothing when every installment has already been paid", () => {
      const rule = makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 6 });

      expect(generateInstallmentProjections(rule, WIDE_START, WIDE_END)).toEqual([]);
    });

    it("returns nothing when more installments are recorded as paid than the plan has", () => {
      const rule = makeInstallmentRule({}, { installmentCount: 6, installmentsPaid: 9 });

      expect(generateInstallmentProjections(rule, WIDE_START, WIDE_END)).toEqual([]);
    });
  });

  describe("a fresh 6 x 200 plan starting 2026-01-10", () => {
    const freshRule = () => makeInstallmentRule({ startDate: "2026-01-10" });

    it("emits one payment per month on the plan's start day-of-month", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-10",
        "2026-02-10",
        "2026-03-10",
        "2026-04-10",
        "2026-05-10",
        "2026-06-10",
      ]);
    });

    it("charges the installment amount from the config, not the rule's own amount", () => {
      // rule.amount is deliberately stale/wrong (999); the plan says 200 per month.
      const rule = makeInstallmentRule({ startDate: "2026-01-10", amount: 999 });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(amountsOf(rows)).toEqual([200, 200, 200, 200, 200, 200]);
    });

    it("treats every installment as pure principal with zero interest (0% BNPL)", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      expect(breakdownsOf(rows).map((b) => b.principalPaid)).toEqual([
        200, 200, 200, 200, 200, 200,
      ]);
      expect(breakdownsOf(rows).map((b) => b.interestPaid)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("reports the full plan length as totalPayments on every installment", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      expect(breakdownsOf(rows).map((b) => b.totalPayments)).toEqual([6, 6, 6, 6, 6, 6]);
    });

    it("numbers installments from 1 and drains the remaining balance to 0 on the last one", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);
      const breakdowns = breakdownsOf(rows);

      expect(breakdowns.map((b) => b.paymentNumber)).toEqual([1, 2, 3, 4, 5, 6]);
      // remainingBalance = (installmentCount - paymentNumber) * installmentAmount
      // 5*200, 4*200, 3*200, 2*200, 1*200, 0*200
      expect(breakdowns.map((b) => b.remainingBalance)).toEqual([1000, 800, 600, 400, 200, 0]);
    });

    it("keeps remainingBalance in lockstep with paymentNumber across the whole schedule", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      for (const breakdown of breakdownsOf(rows)) {
        expect(breakdown.remainingBalance).toBe((6 - breakdown.paymentNumber) * 200);
      }
    });

    it("gives each installment its own monthly occurrence id", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      expect(occurrenceIdsOf(rows)).toEqual([
        "inst-1_2026-01",
        "inst-1_2026-02",
        "inst-1_2026-03",
        "inst-1_2026-04",
        "inst-1_2026-05",
        "inst-1_2026-06",
      ]);
      expect(duplicates(occurrenceIdsOf(rows))).toEqual([]);
    });

    it("emits expense-typed rows attributed to the expense rule", () => {
      const rows = generateInstallmentProjections(freshRule(), WIDE_START, WIDE_END);

      expect(rows.map((row) => row.type)).toEqual(Array(6).fill("expense"));
      expect(rows.map((row) => row.sourceType)).toEqual(Array(6).fill("expense_rule"));
      expect(rows.map((row) => row.status)).toEqual(Array(6).fill("projected"));
      expect(sourceIdsOf(rows)).toEqual(Array(6).fill("inst-1"));
    });
  });

  describe("partially paid plans", () => {
    const paidTwo = () => makeInstallmentRule({ startDate: "2026-01-10" }, { installmentsPaid: 2 });

    it("skips the months already paid and starts at the next unpaid month", () => {
      const rows = generateInstallmentProjections(paidTwo(), WIDE_START, WIDE_END);

      // Jan and Feb are paid, so only Mar-Jun remain.
      expect(datesOf(rows)).toEqual(["2026-03-10", "2026-04-10", "2026-05-10", "2026-06-10"]);
    });

    it("numbers the first remaining installment by its true position in the plan", () => {
      const rows = generateInstallmentProjections(paidTwo(), WIDE_START, WIDE_END);

      expect(breakdownsOf(rows).map((b) => b.paymentNumber)).toEqual([3, 4, 5, 6]);
    });

    it("carries the outstanding balance forward from the paid installments", () => {
      const rows = generateInstallmentProjections(paidTwo(), WIDE_START, WIDE_END);

      // Payment 3 of 6 leaves 3 unpaid after it: 3 * 200 = 600.
      expect(breakdownsOf(rows).map((b) => b.remainingBalance)).toEqual([600, 400, 200, 0]);
      expect(breakdownsOf(rows).map((b) => b.totalPayments)).toEqual([6, 6, 6, 6]);
    });

    it("still emits the final installment when only one is left", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-10" }, { installmentsPaid: 5 });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual(["2026-06-10"]);
      expect(breakdownsOf(rows)[0].paymentNumber).toBe(6);
      expect(breakdownsOf(rows)[0].remainingBalance).toBe(0);
    });
  });

  describe("view window", () => {
    const rule = () => makeInstallmentRule({ startDate: "2026-01-10" });

    it("hides payments before the window start but still counts their slots", () => {
      const rows = generateInstallmentProjections(rule(), d("2026-03-01"), d("2026-05-31"));

      expect(datesOf(rows)).toEqual(["2026-03-10", "2026-04-10", "2026-05-10"]);
      // Jan and Feb consumed slots 1 and 2 even though they are not visible.
      expect(breakdownsOf(rows).map((b) => b.paymentNumber)).toEqual([3, 4, 5]);
      expect(breakdownsOf(rows).map((b) => b.remainingBalance)).toEqual([600, 400, 200]);
    });

    it("stops emitting once the schedule runs past the window end", () => {
      const rows = generateInstallmentProjections(rule(), WIDE_START, d("2026-03-15"));

      expect(datesOf(rows)).toEqual(["2026-01-10", "2026-02-10", "2026-03-10"]);
    });

    it("includes a payment landing exactly on the window boundaries", () => {
      const rows = generateInstallmentProjections(rule(), d("2026-02-10"), d("2026-04-10"));

      expect(datesOf(rows)).toEqual(["2026-02-10", "2026-03-10", "2026-04-10"]);
    });

    it("returns nothing when the whole plan is earlier than the window", () => {
      const rows = generateInstallmentProjections(rule(), d("2027-01-01"), d("2027-12-31"));

      expect(rows).toEqual([]);
    });

    it("returns nothing when the whole plan is later than the window", () => {
      const rows = generateInstallmentProjections(rule(), d("2025-01-01"), d("2025-12-31"));

      expect(rows).toEqual([]);
    });
  });

  describe("weekend adjustment", () => {
    // 2026-02-14 is a Saturday; so is its 2026-03-14 anniversary.
    // 2026-04-14 onwards fall on weekdays.
    it("pushes weekend installments to the following Monday when adjustment is 'after'", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-02-14",
        weekendAdjustment: "after",
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-02-16",
        "2026-03-16",
        "2026-04-14",
        "2026-05-14",
        "2026-06-15",
        "2026-07-14",
      ]);
      expect(datesOf(rows).map(weekday)).toEqual(["Mon", "Mon", "Tue", "Thu", "Mon", "Tue"]);
    });

    it("pulls weekend installments back to the preceding Friday when adjustment is 'before'", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-02-14",
        weekendAdjustment: "before",
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-02-13",
        "2026-03-13",
        "2026-04-14",
        "2026-05-14",
        "2026-06-12",
        "2026-07-14",
      ]);
      expect(datesOf(rows).map(weekday)).toEqual(["Fri", "Fri", "Tue", "Thu", "Fri", "Tue"]);
    });

    it("leaves weekend installments in place when adjustment is 'none'", () => {
      // 2026-01-10 is a Saturday and 2026-05-10 is a Sunday.
      const rule = makeInstallmentRule({ startDate: "2026-01-10", weekendAdjustment: "none" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-10",
        "2026-02-10",
        "2026-03-10",
        "2026-04-10",
        "2026-05-10",
        "2026-06-10",
      ]);
      expect(weekday(datesOf(rows)[0])).toBe("Sat");
      expect(weekday(datesOf(rows)[4])).toBe("Sun");
    });
  });

  describe("occurrence overrides", () => {
    it("applies an amount override to only the overridden installment", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-10",
        occurrenceOverrides: { "inst-1_2026-03": { amount: 250 } },
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(amountsOf(rows)).toEqual([200, 200, 250, 200, 200, 200]);
    });

    it("keeps the plan's payment breakdown when an amount override changes the charge", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-10",
        occurrenceOverrides: { "inst-1_2026-03": { amount: 250 } },
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      // The override moves money, not the amortisation of the plan itself.
      expect(breakdownsOf(rows)[2]).toEqual({
        principalPaid: 200,
        interestPaid: 0,
        remainingBalance: 600,
        paymentNumber: 3,
        totalPayments: 6,
      });
    });

    it("drops a skipped installment, shortening the schedule", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-10",
        occurrenceOverrides: { "inst-1_2026-04": { skipped: true } },
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-10",
        "2026-02-10",
        "2026-03-10",
        "2026-05-10",
        "2026-06-10",
      ]);
      // Slot 4 is still counted in the numbering of the surviving rows.
      expect(breakdownsOf(rows).map((b) => b.paymentNumber)).toEqual([1, 2, 3, 5, 6]);
    });

    it("honours a rescheduled date from an override", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-10",
        occurrenceOverrides: { "inst-1_2026-04": { scheduledDate: "2026-04-25" } },
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-10",
        "2026-02-10",
        "2026-03-10",
        "2026-04-25",
        "2026-05-10",
        "2026-06-10",
      ]);
    });

    it("ignores overrides keyed to occurrence ids the plan never produces", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-10",
        occurrenceOverrides: { "inst-1_2027-03": { skipped: true, amount: 1 } },
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(rows).toHaveLength(6);
      expect(amountsOf(rows)).toEqual([200, 200, 200, 200, 200, 200]);
    });
  });

  describe("month-end start dates", () => {
    it("drifts off the month end once February clamps the anniversary", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-31" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      // Documented current behaviour, not desired behaviour: the generator walks
      // the cursor forward with dayjs `addMonths(currentDate, 1)`
      // (installmentProjections.ts:77). Jan 31 + 1 month clamps to Feb 28, and every
      // later step is taken from the clamped date, so the plan permanently loses the
      // month end and settles on the 28th. See "known defects" below.
      expect(datesOf(rows)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-28",
        "2026-04-28",
        "2026-05-28",
        "2026-06-28",
      ]);
    });

    it("still gives each drifted installment a distinct monthly occurrence id", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-31" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      // Clamping alone keeps one payment per calendar month, so ids stay unique
      // here. Combined with weekend adjustment they do collide - see known defects.
      expect(duplicates(occurrenceIdsOf(rows))).toEqual([]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: month-end installment plans lose the month end.
     * installmentProjections.ts:32-37,77 advances a single cursor with dayjs
     * `addMonths(currentDate, 1)`, so once February clamps Jan 31 -> Feb 28 the
     * anchor day is destroyed and every later installment lands on the 28th.
     * CORRECT: bill on the last day of each month (Jan 31, Feb 28, Mar 31, Apr 30,
     * May 31, Jun 30) - i.e. clamp the *original* day-of-month per month, which is
     * exactly what every other monthly projection does via
     * occurrenceCalculator.ts:131-138 (`clampDayToMonth(dayOfMonth, ...)`).
     */
    it.fails("KNOWN DEFECT: keeps a month-end plan on the last day of every month", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-31" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
      ]);
    });

    /**
     * DEFECT: two installments of the same plan can share one occurrenceId.
     * The id is generated from the weekend-*adjusted* date
     * (installmentProjections.ts:43-51), and the cursor drift above shortens the
     * gap between installments. For a plan starting Sat 2026-01-31 with
     * weekendAdjustment "after" the emitted dates are Feb 2, Mar 2, Mar 30, ... so
     * payments 2 and 3 both hash to "inst-1_2026-03" (and January never gets an
     * occurrence at all, while February gets payment 1).
     * CORRECT: one occurrenceId per installment, derived from the logical period
     * rather than the shifted date - otherwise a single override (skip, amount, or
     * reschedule) silently applies to two different payments.
     */
    it.fails("KNOWN DEFECT: gives every installment a unique occurrence id", () => {
      const rule = makeInstallmentRule({
        startDate: "2026-01-31",
        weekendAdjustment: "after",
      });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toHaveLength(6);
      expect(duplicates(occurrenceIdsOf(rows))).toEqual([]);
    });

    /**
     * DEFECT: `installmentConfig.hasInterest` / `interestRate` are ignored.
     * installmentProjections.ts:60-61 hard-codes `principalPaid: installmentAmount`
     * and `interestPaid: 0` regardless of the config, so an interest-bearing
     * installment plan is reported as a 0% plan.
     * CORRECT: apportion each payment between interest and principal (interest > 0
     * on at least the early payments, principal < installmentAmount), the way
     * loanProjections.ts does via the amortisation schedule.
     */
    it.fails("KNOWN DEFECT: apportions interest when the plan charges interest", () => {
      const rule = makeInstallmentRule(
        { startDate: "2026-01-10" },
        { hasInterest: true, interestRate: 12 }
      );

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);
      const breakdowns = breakdownsOf(rows);

      expect(breakdowns.some((b) => b.interestPaid > 0)).toBe(true);
      expect(breakdowns[0].principalPaid).toBeLessThan(200);
    });

    /**
     * DEFECT: `rule.frequency` is ignored - the schedule is always monthly.
     * installmentProjections.ts:32-37,77 only ever steps by one month, so a
     * bi-weekly plan is silently projected as monthly. The occurrence ids still use
     * the declared frequency (occurrenceIdGenerator.ts:75-79), producing the
     * nonsensical BW1/BW3/BW5 sequence - every other bi-weekly index is skipped.
     * CORRECT: a bi-weekly 6 x 200 plan starting 2026-01-10 should fall every 14
     * days: Jan 10, Jan 24, Feb 7, Feb 21, Mar 7, Mar 21.
     */
    it.fails("KNOWN DEFECT: spaces a bi-weekly installment plan every 14 days", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-10", frequency: "bi-weekly" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(datesOf(rows)).toEqual([
        "2026-01-10",
        "2026-01-24",
        "2026-02-07",
        "2026-02-21",
        "2026-03-07",
        "2026-03-21",
      ]);
    });

    /**
     * DEFECT (same root cause, worse blast radius): a plan whose rule frequency is
     * "one-time" gets the id `<ruleId>_once` for every installment
     * (occurrenceIdGenerator.ts:64-65), because the generator emits six payments for
     * a frequency that means "one". All six then share a single override key, so one
     * skip wipes out the entire plan.
     * CORRECT: distinct occurrence ids per installment.
     */
    it.fails("KNOWN DEFECT: does not collapse a one-time-frequency plan onto one id", () => {
      const rule = makeInstallmentRule({ startDate: "2026-01-10", frequency: "one-time" });

      const rows = generateInstallmentProjections(rule, WIDE_START, WIDE_END);

      expect(rows).toHaveLength(6);
      expect(duplicates(occurrenceIdsOf(rows))).toEqual([]);
    });
  });
});

describe("generateProjections", () => {
  describe("empty inputs", () => {
    it("produces nothing when there are no sources and no rules", () => {
      expect(generateProjections([], [], WIDE_START, WIDE_END)).toEqual([]);
    });

    it("produces nothing when every source and rule falls outside the window", () => {
      const source = makeIncomeSource({ frequency: "one-time", startDate: "2026-06-01" });
      const rule = makeExpenseRule({ frequency: "one-time", startDate: "2026-06-02" });

      expect(generateProjections([source], [rule], d("2026-01-01"), d("2026-03-31"))).toEqual([]);
    });
  });

  describe("combining income and expenses", () => {
    it("returns income and expense projections in a single array", () => {
      const source = makeIncomeSource({
        id: "inc-A",
        frequency: "one-time",
        startDate: "2026-01-20",
      });
      const rule = makeExpenseRule({ id: "exp-A", frequency: "one-time", startDate: "2026-01-05" });

      const rows = generateProjections([source], [rule], d("2026-01-01"), d("2026-01-31"));

      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.type)).toEqual(["expense", "income"]);
      expect(rows.map((row) => row.sourceType)).toEqual(["expense_rule", "income_source"]);
      expect(amountsOf(rows)).toEqual([1200, 3000]);
    });

    it("counts every occurrence of every active source and rule", () => {
      // 2 income sources + 3 expense rules, all monthly, over a 3-month window.
      const sources = [
        makeIncomeSource({ id: "inc-A", startDate: "2026-01-05" }),
        makeIncomeSource({ id: "inc-B", startDate: "2026-01-20" }),
      ];
      const rules = [
        makeExpenseRule({ id: "exp-A", startDate: "2026-01-10" }),
        makeExpenseRule({ id: "exp-B", startDate: "2026-01-15" }),
        makeExpenseRule({ id: "exp-C", startDate: "2026-01-25" }),
      ];

      const rows = generateProjections(sources, rules, d("2026-01-01"), d("2026-03-31"));

      // 5 schedules x 3 months (Jan/Feb/Mar) = 15 rows.
      expect(rows).toHaveLength(15);
      const perSource = (id: string) => sourceIdsOf(rows).filter((s) => s === id).length;
      expect(perSource("inc-A")).toBe(3);
      expect(perSource("inc-B")).toBe(3);
      expect(perSource("exp-A")).toBe(3);
      expect(perSource("exp-B")).toBe(3);
      expect(perSource("exp-C")).toBe(3);
    });
  });

  describe("sorting", () => {
    it("orders the merged result ascending by scheduled date across both kinds", () => {
      // Income is pushed into the array before expenses (projectionGenerator.ts:26-35),
      // so putting the LATEST date on an income source and the EARLIEST on an expense
      // rule means insertion order is Mar, Feb-10, Jan, Feb-25 - visibly unsorted if
      // the sort at projectionGenerator.ts:38-40 were removed.
      const sources = [
        makeIncomeSource({ id: "inc-late", frequency: "one-time", startDate: "2026-03-20" }),
        makeIncomeSource({ id: "inc-mid", frequency: "one-time", startDate: "2026-02-10" }),
      ];
      const rules = [
        makeExpenseRule({ id: "exp-early", frequency: "one-time", startDate: "2026-01-05" }),
        makeExpenseRule({ id: "exp-mid", frequency: "one-time", startDate: "2026-02-25" }),
      ];

      const rows = generateProjections(sources, rules, d("2026-01-01"), d("2026-03-31"));

      expect(datesOf(rows)).toEqual(["2026-01-05", "2026-02-10", "2026-02-25", "2026-03-20"]);
      expect(sourceIdsOf(rows)).toEqual(["exp-early", "inc-mid", "exp-mid", "inc-late"]);
    });

    it("orders correctly across a month boundary", () => {
      // The sort parses `new Date(scheduledDate)` (projectionGenerator.ts:39), which
      // reads "YYYY-MM-DD" as UTC midnight. Under the suite's pinned TZ=UTC that
      // agrees with calendar order; the sibling timezone suite (vitest.config.tz.ts)
      // covers the risk of a non-zero UTC offset shifting these parses.
      const source = makeIncomeSource({
        id: "inc-A",
        frequency: "one-time",
        startDate: "2026-02-01",
      });
      const rule = makeExpenseRule({ id: "exp-A", frequency: "one-time", startDate: "2026-01-31" });

      const rows = generateProjections([source], [rule], d("2026-01-01"), d("2026-02-28"));

      expect(datesOf(rows)).toEqual(["2026-01-31", "2026-02-01"]);
      expect(sourceIdsOf(rows)).toEqual(["exp-A", "inc-A"]);
    });

    it("keeps both transactions when two land on the same day", () => {
      const source = makeIncomeSource({
        id: "inc-A",
        frequency: "one-time",
        startDate: "2026-01-15",
      });
      const rule = makeExpenseRule({ id: "exp-A", frequency: "one-time", startDate: "2026-01-15" });

      const rows = generateProjections([source], [rule], d("2026-01-01"), d("2026-01-31"));

      expect(datesOf(rows)).toEqual(["2026-01-15", "2026-01-15"]);
      expect(sourceIdsOf(rows)).toHaveLength(2);
    });

    it("preserves insertion order for same-day ties: income first, then expenses in rule order", () => {
      // Array.prototype.sort is stable per spec (and in V8), and income is pushed
      // before expenses, so a same-date tie must come out income-then-expense with
      // expenses in the order the rules were supplied. This assertion deliberately
      // pins that dependency on sort stability - it is the only thing keeping the
      // day's ordering deterministic, since the comparator returns 0 for ties.
      const source = makeIncomeSource({
        id: "inc-A",
        frequency: "one-time",
        startDate: "2026-01-15",
      });
      const rules = [
        makeExpenseRule({ id: "exp-first", frequency: "one-time", startDate: "2026-01-15" }),
        makeExpenseRule({ id: "exp-second", frequency: "one-time", startDate: "2026-01-15" }),
      ];

      const rows = generateProjections([source], rules, d("2026-01-01"), d("2026-01-31"));

      expect(sourceIdsOf(rows)).toEqual(["inc-A", "exp-first", "exp-second"]);
    });
  });

  describe("inactive sources and rules", () => {
    it("contributes nothing for an inactive income source", () => {
      const active = makeIncomeSource({
        id: "inc-on",
        frequency: "one-time",
        startDate: "2026-01-10",
      });
      const inactive = makeIncomeSource({
        id: "inc-off",
        frequency: "one-time",
        startDate: "2026-01-11",
        isActive: false,
      });

      const rows = generateProjections([active, inactive], [], d("2026-01-01"), d("2026-01-31"));

      expect(sourceIdsOf(rows)).toEqual(["inc-on"]);
    });

    it("contributes nothing for an inactive expense rule", () => {
      const active = makeExpenseRule({
        id: "exp-on",
        frequency: "one-time",
        startDate: "2026-01-10",
      });
      const inactive = makeExpenseRule({
        id: "exp-off",
        frequency: "one-time",
        startDate: "2026-01-11",
        isActive: false,
      });

      const rows = generateProjections([], [active, inactive], d("2026-01-01"), d("2026-01-31"));

      expect(sourceIdsOf(rows)).toEqual(["exp-on"]);
    });

    it("contributes nothing for an inactive installment plan", () => {
      const inactive = makeInstallmentRule({ startDate: "2026-01-10", isActive: false });

      expect(generateProjections([], [inactive], WIDE_START, WIDE_END)).toEqual([]);
    });

    it("returns an empty array when every input is inactive", () => {
      const source = makeIncomeSource({ isActive: false });
      const rule = makeExpenseRule({ isActive: false });

      expect(generateProjections([source], [rule], WIDE_START, WIDE_END)).toEqual([]);
    });
  });

  describe("every expense type in one call", () => {
    const fixture = () => {
      const income = makeIncomeSource({ id: "inc-A", startDate: "2026-01-05" });
      const rules = [
        makeExpenseRule({ id: "exp-fixed", expenseType: "fixed", startDate: "2026-01-20" }),
        makeExpenseRule({
          id: "exp-variable",
          expenseType: "variable",
          startDate: "2026-01-12",
          amount: 300,
        }),
        makeExpenseRule({
          id: "exp-once",
          expenseType: "one-time",
          frequency: "one-time",
          startDate: "2026-01-09",
          amount: 50,
        }),
        // Loan: 12,000 @ 12% APR over 24 months, first payment on the 15th.
        makeLoanRule({ id: "exp-loan", startDate: "2026-01-15" }),
        // Card: 5,000 @ 24% APR, minimum-payment strategy, due on the 15th.
        makeCreditRule({ id: "exp-card", startDate: "2026-01-01" }),
        makeInstallmentRule({ id: "exp-inst", startDate: "2026-01-10" }),
      ];
      return { income, rules };
    };

    it("emits the union of all six expense types plus the income, in date order", () => {
      const { income, rules } = fixture();

      const rows = generateProjections([income], rules, d("2026-01-01"), d("2026-01-31"));

      expect(datesOf(rows)).toEqual([
        "2026-01-05", // income
        "2026-01-09", // one-time expense
        "2026-01-10", // installment 1 of 6
        "2026-01-12", // variable expense
        "2026-01-15", // loan payment 1 of 24
        "2026-01-15", // credit card minimum payment
        "2026-01-20", // fixed expense
      ]);
      expect(sourceIdsOf(rows)).toEqual([
        "inc-A",
        "exp-once",
        "exp-inst",
        "exp-variable",
        "exp-loan",
        "exp-card",
        "exp-fixed",
      ]);
    });

    it("attaches a payment breakdown only to the debt-style rows", () => {
      const { income, rules } = fixture();

      const rows = generateProjections([income], rules, d("2026-01-01"), d("2026-01-31"));
      const withBreakdown = rows
        .filter((row) => row.paymentBreakdown !== undefined)
        .map((row) => row.sourceId);

      expect(withBreakdown).toEqual(["exp-inst", "exp-loan", "exp-card"]);
      const plain = rows.filter((row) => row.paymentBreakdown === undefined).map((r) => r.sourceId);
      expect(plain).toEqual(["inc-A", "exp-once", "exp-variable", "exp-fixed"]);
    });

    it("keeps each debt row's own schedule metadata", () => {
      const { income, rules } = fixture();

      const rows = generateProjections([income], rules, d("2026-01-01"), d("2026-01-31"));
      const byId = (id: string) => rows.find((row) => row.sourceId === id)!;

      expect(byId("exp-inst").paymentBreakdown).toEqual({
        principalPaid: 200,
        interestPaid: 0,
        remainingBalance: 1000,
        paymentNumber: 1,
        totalPayments: 6,
      });
      // Loan month 1 interest = 12,000 * (12% / 12) = 120.
      expect(byId("exp-loan").paymentBreakdown!.interestPaid).toBeCloseTo(120, 2);
      expect(byId("exp-loan").paymentBreakdown!.totalPayments).toBe(24);
      // Card minimum on 5,000 @ 24% APR: monthly interest = 5,000 * 2% = 100, and the
      // 2% minimum (100) exactly covers it, so nothing goes to principal.
      expect(byId("exp-card").paymentBreakdown!.interestPaid).toBeCloseTo(100, 2);
      expect(byId("exp-card").paymentBreakdown!.principalPaid).toBeCloseTo(0, 2);
    });

    it("stays sorted when the window spans several months of mixed types", () => {
      const { income, rules } = fixture();

      const rows = generateProjections([income], rules, d("2026-01-01"), d("2026-03-31"));
      const sorted = [...datesOf(rows)].sort();

      expect(datesOf(rows)).toEqual(sorted);
      expect(datesOf(rows)[0]).toBe("2026-01-05");
      expect(datesOf(rows)[datesOf(rows).length - 1]).toBe("2026-03-20");
    });
  });
});
