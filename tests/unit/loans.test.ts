import { describe, expect, it } from "vitest";
import { calculateAmortizationSchedule } from "@/lib/logic/amortization/loanAmortization";
import { generateLoanProjections } from "@/lib/logic/projectionEngine/loanProjections";
import { makeExpenseRule, makeLoanRule } from "../helpers/builders";
import { d, ymd, ymdAll } from "../helpers/dates";

/**
 * Loans: amortization schedule generation and loan payment projections.
 *
 * Money derived from interest math is asserted with toBeCloseTo(_, 2); values
 * that are exact by construction (0% interest, a user-entered payment, a
 * trimmed final balance) are asserted with toBe.
 */

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Whole calendar months from `from` to `to`, computed from raw Date fields so
 * the assertion never leans on the engine's dayjs helpers.
 * (Gap: tests/helpers/dates.ts exposes daysBetween but no month-distance helper.)
 */
const monthsBetween = (from: Date, to: Date): number =>
  (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

/** Independent PMT: P * r * (1+r)^n / ((1+r)^n - 1). */
const pmt = (principal: number, monthlyRate: number, months: number): number => {
  if (monthlyRate === 0) return principal / months;
  const growth = Math.pow(1 + monthlyRate, months);
  return (principal * (monthlyRate * growth)) / (growth - 1);
};

/** The reference loan used across the projection tests: 12,000 @ 12% APR / 24m. */
const REFERENCE_PMT = pmt(12_000, 0.01, 24); // 564.8816666...

const scheduleDates = (schedule: { date: Date }[]): string[] => ymdAll(schedule.map((s) => s.date));

// ===========================================================================
// calculateAmortizationSchedule
// ===========================================================================

describe("calculateAmortizationSchedule", () => {
  describe("zero-interest loans", () => {
    const schedule = () =>
      calculateAmortizationSchedule({
        principal: 1_200,
        annualRate: 0,
        termMonths: 6,
        startDate: d("2026-01-01"),
      });

    it("splits the principal evenly across the term with no interest at all", () => {
      // 1200 / 6 = 200 exactly; a 0% loan must charge nothing on top.
      expect(schedule().map((step) => step.payment)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(schedule().map((step) => step.interest)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(schedule().map((step) => step.principal)).toEqual([200, 200, 200, 200, 200, 200]);
    });

    it("runs for exactly termMonths periods and pays the balance down to zero", () => {
      const steps = schedule();
      expect(steps).toHaveLength(6);
      expect(steps.map((step) => step.remainingBalance)).toEqual([1000, 800, 600, 400, 200, 0]);
      expect(steps[steps.length - 1].remainingBalance).toBe(0);
    });
  });

  describe("standard amortized loan", () => {
    const schedule = calculateAmortizationSchedule({
      principal: 12_000,
      annualRate: 12,
      termMonths: 24,
      startDate: d("2026-01-15"),
    });

    it("charges exactly one month of interest on the opening balance", () => {
      // 12,000 * (12% / 12) = 12,000 * 0.01 = 120.00, exact in binary floating point.
      expect(schedule[0].interest).toBe(120);
    });

    it("derives the fixed payment from the PMT formula", () => {
      // PMT = 12000 * 0.01 * 1.01^24 / (1.01^24 - 1) = 564.8817
      expect(schedule[0].payment).toBeCloseTo(REFERENCE_PMT, 2);
      expect(schedule[0].payment).toBeCloseTo(564.88, 2);
    });

    it("applies the remainder of the payment to principal", () => {
      // 564.8817 - 120.00 interest = 444.8817 of principal, leaving 11,555.12.
      expect(schedule[0].principal).toBeCloseTo(REFERENCE_PMT - 120, 2);
      expect(schedule[0].principal).toBeCloseTo(444.88, 2);
      expect(schedule[0].remainingBalance).toBeCloseTo(11_555.12, 2);
    });

    it("keeps the payment constant for every period of the term", () => {
      const payments = schedule.map((step) => step.payment);
      expect(payments).toHaveLength(24);
      payments.forEach((payment) => expect(payment).toBeCloseTo(REFERENCE_PMT, 2));
    });
  });

  describe("schedule invariants", () => {
    const schedule = calculateAmortizationSchedule({
      principal: 12_000,
      annualRate: 12,
      termMonths: 24,
      startDate: d("2026-01-15"),
    });

    it("runs for exactly termMonths periods for a well-formed loan", () => {
      expect(schedule).toHaveLength(24);
    });

    it("repays the original principal in full across the schedule", () => {
      const totalPrincipal = schedule.reduce((sum, step) => sum + step.principal, 0);
      expect(totalPrincipal).toBeCloseTo(12_000, 2);
    });

    it("reduces the remaining balance every period and finishes at zero", () => {
      const balances = schedule.map((step) => step.remainingBalance);
      balances.forEach((balance, i) => {
        if (i === 0) {
          expect(balance).toBeLessThan(12_000);
        } else {
          expect(balance).toBeLessThan(balances[i - 1]);
        }
      });
      expect(balances[balances.length - 1]).toBeLessThanOrEqual(0.01);
      expect(balances[balances.length - 1]).toBeGreaterThanOrEqual(0);
    });

    it("splits every payment exactly into principal plus interest", () => {
      schedule.forEach((step) => {
        expect(step.payment).toBeCloseTo(step.principal + step.interest, 2);
      });
    });

    it("charges less interest and repays more principal with every period", () => {
      schedule.forEach((step, i) => {
        if (i === 0) return;
        expect(step.interest).toBeLessThan(schedule[i - 1].interest);
        expect(step.principal).toBeGreaterThan(schedule[i - 1].principal);
      });
    });

    it("charges interest on the previous period's closing balance", () => {
      schedule.forEach((step, i) => {
        if (i === 0) return;
        // 1% monthly rate applied to last period's remaining balance.
        expect(step.interest).toBeCloseTo(schedule[i - 1].remainingBalance * 0.01, 2);
      });
    });
  });

  describe("an explicitly supplied monthlyPayment", () => {
    const schedule = calculateAmortizationSchedule({
      principal: 12_000,
      annualRate: 12,
      termMonths: 24,
      monthlyPayment: 800,
      startDate: d("2026-01-15"),
    });

    it("overrides the computed PMT", () => {
      expect(REFERENCE_PMT).toBeCloseTo(564.88, 2);
      expect(schedule[0].payment).toBe(800);
      // 800 - 120 interest = 680 of principal in the first period.
      expect(schedule[0].principal).toBe(680);
      expect(schedule[0].interest).toBe(120);
    });

    it("retires the loan in fewer periods than the term when it exceeds the PMT", () => {
      expect(schedule.length).toBeLessThan(24);
      expect(schedule).toHaveLength(17);
      expect(schedule[schedule.length - 1].remainingBalance).toBe(0);
    });

    it("trims the final payment to the outstanding balance plus its interest", () => {
      const last = schedule[schedule.length - 1];
      const others = schedule.slice(0, -1);
      // Only 264.65 of principal is left going into period 17, so the payment
      // drops to 264.65 + 2.65 interest = 267.30 rather than a full 800.
      expect(last.payment).toBeLessThan(800);
      expect(last.payment).toBeCloseTo(267.3, 2);
      expect(last.principal).toBeCloseTo(264.65, 2);
      expect(last.payment).toBeCloseTo(last.principal + last.interest, 2);
      expect(last.remainingBalance).toBe(0);
      others.forEach((step) => expect(step.payment).toBe(800));
    });
  });

  describe("payment dates", () => {
    it("advances one calendar month per period from startDate", () => {
      const schedule = calculateAmortizationSchedule({
        principal: 4_000,
        annualRate: 0,
        termMonths: 4,
        startDate: d("2026-01-15"),
      });
      expect(scheduleDates(schedule)).toEqual([
        "2026-01-15",
        "2026-02-15",
        "2026-03-15",
        "2026-04-15",
      ]);
    });

    it("keeps the day of month across a year boundary", () => {
      const schedule = calculateAmortizationSchedule({
        principal: 3_000,
        annualRate: 0,
        termMonths: 3,
        startDate: d("2026-11-10"),
      });
      expect(scheduleDates(schedule)).toEqual(["2026-11-10", "2026-12-10", "2027-01-10"]);
    });

    it("does not mutate the caller's startDate", () => {
      const startDate = d("2026-01-15");
      calculateAmortizationSchedule({
        principal: 4_000,
        annualRate: 0,
        termMonths: 4,
        startDate,
      });
      expect(ymd(startDate)).toBe("2026-01-15");
    });

    describe("known defects", () => {
      /**
       * DEFECT: month-end start dates skip a month.
       * loanAmortization.ts:63 advances with `currentDate.setMonth(getMonth() + 1)`,
       * which overflows when the day of month does not exist in the target month:
       * Jan 31 + 1 month => Feb 31 => Mar 3 in 2026 (28-day February). The schedule
       * then carries the drifted day 3 forward, so a 4-payment loan produced
       * ["2026-01-31", "2026-03-03", "2026-04-03", "2026-05-03"] - February has no
       * payment at all and every later payment is on the wrong day.
       * CORRECT: one payment per calendar month, clamped to the last day of short
       * months: 2026-01-31, 2026-02-28, 2026-03-31, 2026-04-30.
       */
      it.fails(
        "KNOWN DEFECT: clamps a month-end payment day to the last day of short months",
        () => {
          const schedule = calculateAmortizationSchedule({
            principal: 4_000,
            annualRate: 0,
            termMonths: 4,
            startDate: d("2026-01-31"),
          });
          expect(scheduleDates(schedule)).toEqual([
            "2026-01-31",
            "2026-02-28",
            "2026-03-31",
            "2026-04-30",
          ]);
        }
      );

      /**
       * DEFECT (same root cause, loanAmortization.ts:63): because the overflow
       * permanently shifts the day of month, the schedule also loses a payment
       * month entirely - the generated dates cover Jan, Mar, Apr, May with nothing
       * in February. Asserting one distinct calendar month per period makes that
       * visible independently of the exact clamped day.
       */
      it.fails("KNOWN DEFECT: emits one payment per consecutive calendar month", () => {
        const schedule = calculateAmortizationSchedule({
          principal: 4_000,
          annualRate: 0,
          termMonths: 4,
          startDate: d("2026-01-31"),
        });
        const monthOffsets = schedule.map((step) => monthsBetween(d("2026-01-31"), step.date));
        expect(monthOffsets).toEqual([0, 1, 2, 3]);
      });
    });
  });

  describe("negative amortization (payment below the monthly interest)", () => {
    // 10,000 @ 12% APR accrues 100.00 of interest a month; a 50.00 payment can
    // never touch principal, so the balance NEVER reduces and the loan is never
    // repaid. The guard at loanAmortization.ts:47-50 clamps principal at 0 so the
    // loop cannot spin forever - it stops at the maxMonths cap instead.
    const schedule = calculateAmortizationSchedule({
      principal: 10_000,
      annualRate: 12,
      termMonths: 12,
      monthlyPayment: 50,
      startDate: d("2026-01-01"),
    });

    it("terminates at the maxMonths cap instead of hanging", () => {
      expect(schedule).toHaveLength(12);
      expect(scheduleDates(schedule)[11]).toBe("2026-12-01");
    });

    it("clamps principal to zero rather than letting it go negative", () => {
      expect(schedule.map((step) => step.principal)).toEqual(Array(12).fill(0));
    });

    it("leaves the balance untouched for the whole schedule", () => {
      expect(schedule.map((step) => step.remainingBalance)).toEqual(Array(12).fill(10_000));
      expect(schedule.map((step) => step.interest)).toEqual(Array(12).fill(100));
    });

    describe("known defects", () => {
      /**
       * DEFECT: unpaid interest is silently discarded.
       * loanAmortization.ts:47-50 clamps `principal` to 0 when the payment does not
       * cover the interest, then loanAmortization.ts:52 does `balance -= principal`
       * - i.e. subtracts nothing. The 50.00 of interest that went unpaid simply
       * vanishes: the schedule reports a flat 10,000 balance forever, understating
       * the debt and making the loan look interest-free from period 1 onward.
       * CORRECT: unpaid interest capitalises into the balance, so period 1 closes at
       * 10,000 + (100 - 50) = 10,050 and the balance grows every period.
       */
      it.fails("KNOWN DEFECT: capitalises unpaid interest into the outstanding balance", () => {
        expect(schedule[0].remainingBalance).toBeCloseTo(10_050, 2);
        expect(schedule[1].remainingBalance).toBeGreaterThan(schedule[0].remainingBalance);
      });

      /**
       * DEFECT (same root cause, loanAmortization.ts:47-52): the documented split
       * invariant `payment === principal + interest` breaks once principal is
       * clamped - the step claims a 50.00 payment made up of 0 principal and 100.00
       * interest. Any consumer that trusts the breakdown (the projection layer adds
       * principalPaid + interestPaid to get the cash amount) reads a different
       * number from `payment`.
       */
      it.fails(
        "KNOWN DEFECT: keeps payment equal to principal plus interest in every period",
        () => {
          schedule.forEach((step) => {
            expect(step.payment).toBeCloseTo(step.principal + step.interest, 2);
          });
        }
      );
    });
  });

  describe("the maxMonths safety cap", () => {
    it("defaults to 360 periods when termMonths is absent", () => {
      // No termMonths, and a 50.00 payment never dents a 10,000 balance accruing
      // 100.00 a month, so only the 360-period cap can stop the loop.
      const schedule = calculateAmortizationSchedule({
        principal: 10_000,
        annualRate: 12,
        monthlyPayment: 50,
        startDate: d("2026-01-01"),
      });
      expect(schedule).toHaveLength(360);
      // 360 monthly periods from 2026-01 lands on 2055-12.
      expect(ymd(schedule[359].date)).toBe("2055-12-01");
    });

    it("defaults to 360 periods when termMonths is zero", () => {
      const schedule = calculateAmortizationSchedule({
        principal: 10_000,
        annualRate: 12,
        termMonths: 0,
        monthlyPayment: 50,
        startDate: d("2026-01-01"),
      });
      expect(schedule).toHaveLength(360);
    });
  });
});

// ===========================================================================
// generateLoanProjections
// ===========================================================================

describe("generateLoanProjections", () => {
  const VIEW_START = d("2026-01-01");
  const VIEW_END = d("2027-12-31");

  describe("guards", () => {
    it("returns nothing for a rule with no loan configuration", () => {
      expect(generateLoanProjections(makeExpenseRule(), VIEW_START, VIEW_END)).toEqual([]);
    });

    it("returns nothing once every scheduled payment has been made", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 24, termMonths: 24 });
      expect(generateLoanProjections(rule, VIEW_START, VIEW_END)).toEqual([]);
    });

    it("returns nothing when more payments were made than the term allows", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 30, termMonths: 24 });
      expect(generateLoanProjections(rule, VIEW_START, VIEW_END)).toEqual([]);
    });
  });

  describe("the view window", () => {
    it("emits one payment per month for the whole term when the window covers it", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" });
      const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
        "2026-07-01",
        "2026-08-01",
        "2026-09-01",
        "2026-10-01",
        "2026-11-01",
        "2026-12-01",
        "2027-01-01",
        "2027-02-01",
        "2027-03-01",
        "2027-04-01",
        "2027-05-01",
        "2027-06-01",
        "2027-07-01",
        "2027-08-01",
        "2027-09-01",
        "2027-10-01",
        "2027-11-01",
        "2027-12-01",
      ]);
    });

    it("emits only the payments inside the window", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" });
      const projections = generateLoanProjections(rule, d("2026-03-01"), d("2026-05-31"));
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
      ]);
    });

    it("includes payments that land exactly on the window boundaries", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" });
      const projections = generateLoanProjections(rule, d("2026-03-01"), d("2026-05-01"));
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
      ]);
    });

    it("returns nothing when the window closes before the first payment", () => {
      const rule = makeLoanRule({ startDate: "2026-06-01" });
      expect(generateLoanProjections(rule, d("2026-01-01"), d("2026-05-31"))).toEqual([]);
    });

    it("returns nothing when the window opens after the last payment", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" });
      expect(generateLoanProjections(rule, d("2028-01-01"), d("2028-12-31"))).toEqual([]);
    });
  });

  describe("transaction shape", () => {
    const rule = makeLoanRule({ startDate: "2026-01-01" });
    const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);

    it("describes each payment as a projected expense sourced from the rule", () => {
      expect(projections[0]).toMatchObject({
        name: "Car Loan",
        type: "expense",
        category: "debt_payment",
        sourceType: "expense_rule",
        sourceId: "loan-1",
        status: "projected",
        scheduledDate: "2026-01-01",
        occurrenceId: "loan-1_2026-01",
      });
    });

    it("carries the amortization breakdown for the first payment", () => {
      // 12,000 @ 1%/month: 120.00 interest, 564.88 - 120.00 = 444.88 principal,
      // leaving 11,555.12 outstanding.
      const breakdown = projections[0].paymentBreakdown!;
      expect(breakdown.interestPaid).toBe(120);
      expect(breakdown.principalPaid).toBeCloseTo(444.88, 2);
      expect(breakdown.remainingBalance).toBeCloseTo(11_555.12, 2);
      expect(breakdown.paymentNumber).toBe(1);
      expect(breakdown.totalPayments).toBe(24);
    });

    it("reports totalPayments as the loan term for every payment", () => {
      projections.forEach((t) => expect(t.paymentBreakdown!.totalPayments).toBe(24));
    });

    it("shifts the split from interest to principal as the loan amortizes", () => {
      const last = projections[projections.length - 1].paymentBreakdown!;
      // Final period: 5.59 interest on a 559.29 balance, the rest is principal.
      expect(last.interestPaid).toBeCloseTo(5.59, 2);
      expect(last.principalPaid).toBeCloseTo(559.29, 2);
      expect(last.remainingBalance).toBeCloseTo(0, 2);
    });

    it("projects the amount as that period's principal plus interest", () => {
      projections.forEach((t) => {
        const breakdown = t.paymentBreakdown!;
        expect(t.projectedAmount).toBe(breakdown.principalPaid + breakdown.interestPaid);
        expect(t.projectedAmount).toBeCloseTo(REFERENCE_PMT, 2);
      });
    });

    it("numbers the payments consecutively through the term", () => {
      expect(projections.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual(
        Array.from({ length: 24 }, (_, i) => i + 1)
      );
    });
  });

  describe("occurrence overrides", () => {
    it("uses the overridden amount for the matching occurrence only", () => {
      const rule = makeLoanRule({
        startDate: "2026-01-01",
        occurrenceOverrides: { "loan-1_2026-02": { amount: 999 } },
      });
      const projections = generateLoanProjections(rule, d("2026-01-01"), d("2026-03-31"));
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-01-01",
        "2026-02-01",
        "2026-03-01",
      ]);
      expect(projections[1].projectedAmount).toBe(999);
      expect(projections[0].projectedAmount).toBeCloseTo(REFERENCE_PMT, 2);
      expect(projections[2].projectedAmount).toBeCloseTo(REFERENCE_PMT, 2);
    });

    it("keeps the amortization breakdown when only the amount is overridden", () => {
      const rule = makeLoanRule({
        startDate: "2026-01-01",
        occurrenceOverrides: { "loan-1_2026-02": { amount: 999 } },
      });
      const projections = generateLoanProjections(rule, d("2026-01-01"), d("2026-03-31"));
      expect(projections[1].paymentBreakdown!.paymentNumber).toBe(2);
      expect(projections[1].paymentBreakdown!.interestPaid).toBeCloseTo(115.55, 2);
    });

    it("drops a payment whose occurrence is overridden as skipped", () => {
      const rule = makeLoanRule({
        startDate: "2026-01-01",
        occurrenceOverrides: { "loan-1_2026-02": { skipped: true } },
      });
      const projections = generateLoanProjections(rule, d("2026-01-01"), d("2026-03-31"));
      expect(projections.map((t) => t.scheduledDate)).toEqual(["2026-01-01", "2026-03-01"]);
    });

    it("uses an overridden scheduled date for the matching occurrence", () => {
      const rule = makeLoanRule({
        startDate: "2026-01-01",
        occurrenceOverrides: { "loan-1_2026-02": { scheduledDate: "2026-02-20" } },
      });
      const projections = generateLoanProjections(rule, d("2026-01-01"), d("2026-03-31"));
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-01-01",
        "2026-02-20",
        "2026-03-01",
      ]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT 1: the projected payment inflates after every completed payment.
     * loanProjections.ts:28-37 shortens the term (`remainingPayments =
     * termMonths - paymentsMade`) but still passes the FULL `loanConfig.currentBalance`
     * as the principal - nothing in the projection-completion path ever decrements
     * currentBalance. PMT is therefore recomputed over the same 12,000 across ever
     * fewer periods: 564.88 at paymentsMade 0, 586.63 at 1, 636.37 at 3.
     * CORRECT: the contractual payment is fixed for the life of the loan, so the
     * projected amount must not change as payments are recorded.
     */
    it.fails("KNOWN DEFECT: keeps the projected payment constant as payments are made", () => {
      const amountAt = (paymentsMade: number) => {
        const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade });
        return generateLoanProjections(rule, VIEW_START, VIEW_END)[0].projectedAmount;
      };
      expect(amountAt(1)).toBeCloseTo(amountAt(0), 2);
      expect(amountAt(2)).toBeCloseTo(amountAt(0), 2);
    });

    /**
     * DEFECT 2: the remaining schedule slides earlier as payments are made.
     * loanProjections.ts:36 always starts the amortization schedule at
     * `rule.startDate`, no matter how many payments are already behind us. With
     * paymentsMade 3 the 21 remaining payments are dated from 2026-01-01 instead of
     * 2026-04-01, so every payment is 3 months too early and the payoff date moves
     * from 2027-12-01 back to 2027-09-01.
     * CORRECT: payment N+1 falls one month after payment N, i.e. the first remaining
     * payment is `paymentsMade` months after the rule start date.
     */
    it.fails(
      "KNOWN DEFECT: dates the first remaining payment after the payments already made",
      () => {
        const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 3 });
        const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);
        expect(projections[0].scheduledDate).toBe("2026-04-01");
        expect(projections[projections.length - 1].scheduledDate).toBe("2027-12-01");
      }
    );

    /**
     * DEFECT 3: paymentNumber is double-counted.
     * loanProjections.ts:43 computes `paymentsMade + index + 1`, but `index` already
     * restarts from the schedule's own first step - which (defect 2) is dated at
     * `rule.startDate`. With paymentsMade 3 the payment sitting on the rule start
     * date is labelled payment 4 of 24 even though it is the first step of the
     * generated schedule.
     * CORRECT: the number must agree with the payment's position - the step at the
     * rule start date is payment 1. Note this defect and defect 2 have to be fixed
     * together: once the schedule no longer slides, the first projection is
     * legitimately payment 4 AND dated 2026-04-01.
     */
    it.fails("KNOWN DEFECT: does not add paymentsMade on top of the schedule's own index", () => {
      const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 3 });
      const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);
      const atStartDate = projections.find((t) => t.scheduledDate === "2026-01-01");
      expect(atStartDate?.paymentBreakdown?.paymentNumber).toBe(1);
    });

    /**
     * DEFECT 3b (additional, same line): paymentNumber depends on the view window.
     * loanProjections.ts:40-43 filters to the view period BEFORE mapping, so `index`
     * counts positions in the FILTERED array. Scrolling the calendar to June 2026
     * therefore relabels the 6th payment of the loan as payment 1 of 24 - the same
     * occurrence reports a different paymentNumber depending on what the user is
     * looking at.
     * CORRECT: paymentNumber is a property of the loan, not of the viewport - the
     * June payment of a loan starting 2026-01-01 is payment 6 of 24.
     */
    it.fails(
      "KNOWN DEFECT: numbers payments by position in the loan, not in the view window",
      () => {
        const rule = makeLoanRule({ startDate: "2026-01-01" });
        const projections = generateLoanProjections(rule, d("2026-06-01"), d("2026-07-31"));
        expect(projections.map((t) => t.scheduledDate)).toEqual(["2026-06-01", "2026-07-01"]);
        expect(projections.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([6, 7]);
      }
    );

    /**
     * DEFECT 4: loanConfig.monthlyPayment is ignored.
     * loanProjections.ts:32-37 builds the amortization config from principal, rate,
     * term and start date only - it never forwards `loanConfig.monthlyPayment`, even
     * though calculateAmortizationSchedule accepts it and honours it. A user who
     * entered a real contractual payment of 800.00 still sees a recomputed PMT of
     * 564.88 on the calendar.
     * CORRECT: the user-entered payment drives the projections (and, with 800 a
     * month, the loan is retired in 17 payments instead of 24).
     */
    it.fails(
      "KNOWN DEFECT: projects the user-entered monthlyPayment instead of a recomputed PMT",
      () => {
        const rule = makeLoanRule({ startDate: "2026-01-01" }, { monthlyPayment: 800 });
        const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);
        expect(projections[0].projectedAmount).toBe(800);
        expect(projections).toHaveLength(17);
      }
    );

    /**
     * DEFECT 5: loanConfig.firstPaymentDate is ignored.
     * loanProjections.ts:36 keys the schedule off `rule.startDate`; nothing reads
     * `loanConfig.firstPaymentDate`. A loan drawn down on 2026-01-01 whose first
     * instalment is contractually due on 2026-02-01 is still projected with a
     * payment on 2026-01-01, overstating that month's outgoings.
     * CORRECT: the schedule starts on firstPaymentDate.
     */
    it.fails("KNOWN DEFECT: starts the schedule on the configured firstPaymentDate", () => {
      const rule = makeLoanRule(
        { startDate: "2026-01-01" },
        { firstPaymentDate: "2026-02-01", loanStartDate: "2026-01-01" }
      );
      const projections = generateLoanProjections(rule, d("2026-01-01"), d("2026-04-30"));
      expect(projections.map((t) => t.scheduledDate)).toEqual([
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
      ]);
    });

    /**
     * DEFECT 6: loanConfig.calculationType is ignored.
     * loanProjections.ts:32-37 always calls calculateAmortizationSchedule, which only
     * implements the amortized method, and never inspects `calculationType`. A
     * "flat_rate" loan (interest charged on the ORIGINAL principal every period, so
     * a constant interest component) and a "reducing_balance" loan produce output
     * byte-identical to "amortized".
     * CORRECT: the three calculation types produce different interest/principal
     * splits. Under flat rate at 12% on 12,000 over 24 months, every period charges
     * 12,000 * 1% = 120.00 of interest, not a declining amount.
     */
    it.fails("KNOWN DEFECT: honours a flat_rate calculationType", () => {
      const flat = generateLoanProjections(
        makeLoanRule({ startDate: "2026-01-01" }, { calculationType: "flat_rate" }),
        VIEW_START,
        VIEW_END
      );
      const amortized = generateLoanProjections(
        makeLoanRule({ startDate: "2026-01-01" }, { calculationType: "amortized" }),
        VIEW_START,
        VIEW_END
      );
      expect(flat).not.toEqual(amortized);
      // Flat rate charges interest on the original principal every period.
      expect(flat[1].paymentBreakdown!.interestPaid).toBeCloseTo(120, 2);
    });

    it.fails("KNOWN DEFECT: honours a reducing_balance calculationType", () => {
      const reducing = generateLoanProjections(
        makeLoanRule({ startDate: "2026-01-01" }, { calculationType: "reducing_balance" }),
        VIEW_START,
        VIEW_END
      );
      const amortized = generateLoanProjections(
        makeLoanRule({ startDate: "2026-01-01" }, { calculationType: "amortized" }),
        VIEW_START,
        VIEW_END
      );
      expect(reducing).not.toEqual(amortized);
    });
  });
});
