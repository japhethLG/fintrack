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

    describe("month-end start dates (were known defects; fixed by stepping from a fixed anchor)", () => {
      /**
       * FIXED - was: month-end start dates skip a month.
       * loanAmortization.ts:63 advances with `currentDate.setMonth(getMonth() + 1)`,
       * which overflows when the day of month does not exist in the target month:
       * Jan 31 + 1 month => Feb 31 => Mar 3 in 2026 (28-day February). The schedule
       * then carries the drifted day 3 forward, so a 4-payment loan produced
       * ["2026-01-31", "2026-03-03", "2026-04-03", "2026-05-03"] - February has no
       * payment at all and every later payment is on the wrong day.
       * CORRECT: one payment per calendar month, clamped to the last day of short
       * months: 2026-01-31, 2026-02-28, 2026-03-31, 2026-04-30.
       */
      it(
        "clamps a month-end payment day to the last day of short months",
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
      it("emits one payment per consecutive calendar month", () => {
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
    // never touch principal. The unpaid interest capitalises, so the balance
    // GROWS (see the defect notes below for why the old "flat 10,000" was wrong).
    const schedule = calculateAmortizationSchedule({
      principal: 10_000,
      annualRate: 12,
      termMonths: 12,
      monthlyPayment: 50,
      startDate: d("2026-01-01"),
    });

    it("terminates at the term instead of hanging", () => {
      expect(schedule).toHaveLength(12);
      expect(scheduleDates(schedule)[11]).toBe("2026-12-01");
    });

    it("reports the shortfall as NEGATIVE principal instead of clamping it to zero", () => {
      // REWRITTEN (was: "clamps principal to zero rather than letting it go negative").
      // Month 1: interest 100.00, paid 50.00 -> principal = 50 - 100 = -50.00.
      // Month 2: balance 10,050 -> interest 100.50 -> principal = 50 - 100.50 = -50.50.
      // Clamping at 0 discarded the unpaid interest, which broke
      // remaining = opening + interest - paid (see the next test).
      expect(schedule[0].principal).toBeCloseTo(-50, 9);
      expect(schedule[1].principal).toBeCloseTo(-50.5, 9);
    });

    it("grows the balance: 10,050.00, 10,100.50, 10,151.50 ...", () => {
      // REWRITTEN (was: "leaves the balance untouched for the whole schedule", 10,000 x 12).
      // 10,000 + 100.00 - 50 = 10,050.00; x1.01 - 50 = 10,100.50; x1.01 - 50 = 10,151.505 -> 10,151.50
      // (emitted rounded to the cent; 10,151.505 is 10,151.50 in binary floating point).
      expect(schedule[0].remainingBalance).toBe(10_050);
      expect(schedule[1].remainingBalance).toBe(10_100.5);
      expect(schedule[2].remainingBalance).toBeCloseTo(10_151.5, 2);
      expect(schedule.slice(0, 11).map((s) => s.interest).every((x, i, a) => i === 0 || x > a[i - 1])).toBe(true);
    });

    it("collects the capitalised debt in the last term month (the loan matures at its term)", () => {
      // After 11 payments of 50 the balance is 10,000*1.01^11 - 50*(1.01^11 - 1)/0.01
      //   = 11,156.68347 - 50 * 11.566835 = 10,578.3417; month 12 interest 1% = 105.7834
      //   -> pays 10,578.3417 + 105.7834 = 10,684.1252.
      const last = schedule[11];
      expect(last.principal).toBeCloseTo(10_578.3417, 3);
      expect(last.payment).toBeCloseTo(10_684.1252, 3);
      expect(last.remainingBalance).toBe(0);
    });

    describe("previously known defects (fixed)", () => {
      /**
       * FIXED - was: unpaid interest silently discarded (loanAmortization.ts clamped
       * principal to 0, then `balance -= principal` subtracted nothing).
       * CORRECT: unpaid interest capitalises, so period 1 closes at
       * 10,000 + (100 - 50) = 10,050 and the balance grows every period.
       */
      it("capitalises unpaid interest into the outstanding balance", () => {
        expect(schedule[0].remainingBalance).toBeCloseTo(10_050, 2);
        expect(schedule[1].remainingBalance).toBeGreaterThan(schedule[0].remainingBalance);
      });

      /**
       * FIXED - was: the split invariant `payment === principal + interest` broke once
       * principal was clamped (a 50.00 payment made of 0 principal and 100.00 interest).
       */
      it("keeps payment equal to principal plus interest in every period", () => {
        schedule.forEach((step) => {
          expect(step.payment).toBeCloseTo(step.principal + step.interest, 2);
        });
      });
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
      // Final period: 5.59 interest, the rest is principal.
      // REWRITTEN (MANUAL-L3): payments are whole cents, so 23 payments of 564.88 (not 564.8817) leave
      // 23 x 0.17 cents more for the last one: 559.34, not 559.29.
      expect(last.interestPaid).toBeCloseTo(5.59, 2);
      expect(last.principalPaid).toBeCloseTo(559.34, 2);
      expect(last.remainingBalance).toBeCloseTo(0, 2);
    });

    it("projects the amount as that period's principal plus interest", () => {
      // REWRITTEN (MANUAL-L3): projected debt payments are whole cents; the last payment absorbs the rounding.
      projections.forEach((t, i) => {
        const breakdown = t.paymentBreakdown!;
        expect(t.projectedAmount).toBeCloseTo(breakdown.principalPaid + breakdown.interestPaid, 10);
        expect(t.projectedAmount).toBeCloseTo(REFERENCE_PMT, i === projections.length - 1 ? 0 : 2);
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

  describe("previously known defects (fixed) and the ones still open", () => {
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
    it(
      "keeps the projected payment constant as payments are made", () => {
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
    it(
      "dates the first remaining payment after the payments already made",
      () => {
        const rule = makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 3 });
        const projections = generateLoanProjections(rule, VIEW_START, VIEW_END);
        expect(projections[0].scheduledDate).toBe("2026-04-01");
        expect(projections[projections.length - 1].scheduledDate).toBe("2027-12-01");
      }
    );

    /**
     * FIXED (and REWRITTEN) - DEFECT 3: paymentNumber is the ABSOLUTE position in the loan.
     *
     * The original test asserted "the payment sitting on the rule start date is payment 1"
     * while, in the same file, the next test asserted that paymentNumber is the absolute
     * position in the loan regardless of the window. Those cannot both hold once payments
     * have been made: with paymentsMade 3 the start-date payment is one of the three
     * ALREADY PAID and is no longer projected at all. The absolute convention is the
     * correct one because the old number changed with the viewport (June 2026 printed
     * #6 in a year view and #1 in a June view, see the next test); a number that changes
     * when the user scrolls cannot be right under any convention.
     *
     * Rewritten to the absolute convention, in both halves that the old test mixed up:
     *  - nothing paid: the payment on the rule start date (2026-01-01) IS payment 1;
     *  - 3 paid: the first PROJECTED payment is the 4th (2026-04-01), not 7 (3 added to
     *    an index that already counted them) and not 1 (restarting from the window).
     */
    it("numbers the payment on the rule start date 1, and the first projected payment after 3 made number 4", () => {
      const fresh = generateLoanProjections(makeLoanRule({ startDate: "2026-01-01" }), VIEW_START, VIEW_END);
      const atStartDate = fresh.find((t) => t.scheduledDate === "2026-01-01");
      expect(atStartDate?.paymentBreakdown?.paymentNumber).toBe(1);

      const resumed = generateLoanProjections(
        makeLoanRule({ startDate: "2026-01-01" }, { paymentsMade: 3 }),
        VIEW_START,
        VIEW_END
      );
      expect(resumed[0].scheduledDate).toBe("2026-04-01"); // months 1-3 are already paid
      expect(resumed[0].paymentBreakdown?.paymentNumber).toBe(4);
      expect(resumed.find((t) => t.scheduledDate === "2026-01-01")).toBeUndefined();
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
    it(
      "numbers payments by position in the loan, not in the view window",
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
    it(
      "projects the user-entered monthlyPayment instead of a recomputed PMT",
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
    it("honours a flat_rate calculationType", () => {
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

    it("honours a reducing_balance calculationType", () => {
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
