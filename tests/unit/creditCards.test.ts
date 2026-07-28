import { describe, it, expect } from "vitest";
import type { CreditConfig } from "@/lib/types";
import {
  calculateMinimumPayment,
  getEffectivePayment,
  calculatePaymentForMonths,
  formatPayoffTime,
} from "@/lib/logic/creditCardCalculator/paymentCalculator";
import {
  calculateCreditCardPayoff,
  calculateDecliningMinimumPayoff,
} from "@/lib/logic/creditCardCalculator/payoffCalculator";
import { generateCreditProjections } from "@/lib/logic/projectionEngine/creditProjections";
import { makeCreditConfig, makeCreditRule, sumBy } from "../helpers/builders";
import { d, ymdAll } from "../helpers/dates";

/**
 * Local helper: independently computed monthly interest. Deliberately not
 * reusing the production expression so an APR-conversion bug cannot cancel
 * itself out.
 */
const monthlyInterestOf = (balance: number, apr: number): number => (balance * (apr / 100)) / 12;

/** Local helper: the payment amounts of a schedule, in order. */
const paymentsOf = (schedule: { payment: number }[]): number[] => schedule.map((s) => s.payment);

/** Local helper: true when every value is strictly smaller than the one before it. */
const strictlyDecreasing = (values: number[]): boolean =>
  values.every((value, i) => i === 0 || value < values[i - 1]);

// ============================================================================
// calculateMinimumPayment
// ============================================================================

describe("calculateMinimumPayment", () => {
  describe("percent_only", () => {
    it("charges the balance percentage when it exceeds the floor", () => {
      // 2% of 5,000 = 100, which beats the 25 floor.
      const config = makeCreditConfig({
        currentBalance: 5_000,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_only",
      });
      expect(calculateMinimumPayment(config)).toBe(100);
    });

    it("charges the floor when the balance percentage falls below it", () => {
      // 2% of 400 = 8, so the 25 floor wins.
      const config = makeCreditConfig({
        currentBalance: 400,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_only",
      });
      expect(calculateMinimumPayment(config)).toBe(25);
    });

    it("ignores the APR entirely", () => {
      const base = { currentBalance: 5_000, minimumPaymentPercent: 2, minimumPaymentFloor: 25 };
      const low = makeCreditConfig({ ...base, apr: 0, minimumPaymentMethod: "percent_only" });
      const high = makeCreditConfig({ ...base, apr: 36, minimumPaymentMethod: "percent_only" });
      expect(calculateMinimumPayment(low)).toBe(calculateMinimumPayment(high));
    });

    it("treats an unrecognised method as percent_only", () => {
      const config = makeCreditConfig({
        currentBalance: 5_000,
        apr: 24,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "something_else" as CreditConfig["minimumPaymentMethod"],
      });
      // Percentage only (100), not percentage + the 100 of monthly interest.
      expect(calculateMinimumPayment(config)).toBe(100);
    });
  });

  describe("percent_plus_interest", () => {
    it("adds one month of interest on top of the balance percentage", () => {
      const config = makeCreditConfig({
        currentBalance: 2_000,
        apr: 18,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_plus_interest",
      });
      // 2% of 2,000 = 40; interest = 2,000 * 18% / 12 = 30 -> 70.
      const expected = 2_000 * 0.02 + monthlyInterestOf(2_000, 18);
      expect(expected).toBe(70);
      expect(calculateMinimumPayment(config)).toBeCloseTo(expected, 10);
    });

    it("charges the floor when percentage plus interest falls below it", () => {
      const config = makeCreditConfig({
        currentBalance: 200,
        apr: 12,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_plus_interest",
      });
      // 2% of 200 = 4; interest = 2 -> 6, so the 25 floor wins.
      expect(calculateMinimumPayment(config)).toBe(25);
    });
  });
});

// ============================================================================
// getEffectivePayment
// ============================================================================

describe("getEffectivePayment", () => {
  const base = {
    currentBalance: 5_000,
    apr: 24,
    minimumPaymentPercent: 2,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_only" as const,
  };

  it("returns the configured fixed amount for the fixed strategy", () => {
    const config = makeCreditConfig({ ...base, paymentStrategy: "fixed", fixedPaymentAmount: 750 });
    expect(getEffectivePayment(config)).toBe(750);
  });

  it("falls back to the minimum payment when the fixed strategy has no amount", () => {
    const config = makeCreditConfig({
      ...base,
      paymentStrategy: "fixed",
      fixedPaymentAmount: undefined,
    });
    // 2% of 5,000 = 100.
    expect(getEffectivePayment(config)).toBe(100);
  });

  it("returns the whole balance for the full_balance strategy", () => {
    const config = makeCreditConfig({ ...base, paymentStrategy: "full_balance" });
    expect(getEffectivePayment(config)).toBe(5_000);
  });

  it("returns the minimum payment for the minimum strategy", () => {
    const config = makeCreditConfig({ ...base, paymentStrategy: "minimum" });
    expect(getEffectivePayment(config)).toBe(100);
  });

  it("returns the minimum payment for an unrecognised strategy", () => {
    const config = makeCreditConfig({
      ...base,
      paymentStrategy: "avalanche" as CreditConfig["paymentStrategy"],
      fixedPaymentAmount: 750,
    });
    expect(getEffectivePayment(config)).toBe(100);
  });
});

// ============================================================================
// calculatePaymentForMonths
// ============================================================================

describe("calculatePaymentForMonths", () => {
  it("splits the balance evenly across the months at zero APR", () => {
    expect(calculatePaymentForMonths(1_200, 0, 6)).toBe(200);
  });

  it("does not round the zero-APR result to whole cents", () => {
    // 1,000 / 7 is a repeating fraction; the zero-rate branch returns it raw.
    expect(calculatePaymentForMonths(1_000, 0, 7)).toBe(1_000 / 7);
  });

  it("uses the PMT formula for a non-zero APR", () => {
    // PMT = P*r*(1+r)^n / ((1+r)^n - 1) with P=5,000 r=0.02 n=12 -> 472.7979831...
    const r = 0.24 / 12;
    const raw = (5_000 * (r * Math.pow(1 + r, 12))) / (Math.pow(1 + r, 12) - 1);
    expect(raw).toBeCloseTo(472.797983, 6);
    expect(calculatePaymentForMonths(5_000, 24, 12)).toBe(Math.ceil(raw * 100) / 100);
    expect(calculatePaymentForMonths(5_000, 24, 12)).toBe(472.8);
  });

  it("rounds the PMT result UP to the next cent even when it would round down", () => {
    // P=3,000 r=0.015 n=24 -> 149.772305... Rounding to nearest gives 149.77;
    // the calculator must ceil to 149.78 so the target month count is met.
    const r = 0.18 / 12;
    const raw = (3_000 * (r * Math.pow(1 + r, 24))) / (Math.pow(1 + r, 24) - 1);
    expect(raw).toBeCloseTo(149.772306, 6);
    expect(Math.round(raw * 100) / 100).toBe(149.77);
    expect(calculatePaymentForMonths(3_000, 18, 24)).toBe(149.78);
  });

  it("produces a payment that actually retires the balance in the target months", () => {
    const payment = calculatePaymentForMonths(3_000, 18, 24);
    const schedule = calculateCreditCardPayoff(3_000, 18, payment, d("2026-01-15"));
    expect(schedule).toHaveLength(24);
    expect(schedule[23].remainingBalance).toBe(0);
  });
});

// ============================================================================
// formatPayoffTime
// ============================================================================

describe("formatPayoffTime", () => {
  it("formats a sub-year count in months, pluralising correctly", () => {
    expect(formatPayoffTime(0)).toBe("0 months");
    expect(formatPayoffTime(1)).toBe("1 month");
    expect(formatPayoffTime(11)).toBe("11 months");
  });

  it("formats whole years without a month component", () => {
    expect(formatPayoffTime(12)).toBe("1 year");
    expect(formatPayoffTime(24)).toBe("2 years");
  });

  it("formats years plus a remainder, pluralising each part independently", () => {
    expect(formatPayoffTime(13)).toBe("1 year, 1 month");
    expect(formatPayoffTime(25)).toBe("2 years, 1 month");
    expect(formatPayoffTime(26)).toBe("2 years, 2 months");
  });

  it("reports a never-ending payoff for Infinity", () => {
    expect(formatPayoffTime(Infinity)).toBe("Never (payment too low)");
  });

  it("reports a never-ending payoff for NaN, since NaN is not finite", () => {
    expect(formatPayoffTime(NaN)).toBe("Never (payment too low)");
  });
});

// ============================================================================
// calculateCreditCardPayoff (fixed payment)
// ============================================================================

describe("calculateCreditCardPayoff", () => {
  describe("schedule invariants for a fixed payment", () => {
    // 5,000 at 24% APR (2% monthly) paying 500/month retires in 12 payments:
    // month 1 interest 100 / principal 400, month 12 is the trimmed remainder.
    const schedule = () => calculateCreditCardPayoff(5_000, 24, 500, d("2026-08-15"));

    it("numbers months from 1 upward with no gaps", () => {
      expect(schedule().map((s) => s.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });

    it("advances the date exactly one calendar month per payment, across a year boundary", () => {
      expect(ymdAll(schedule().map((s) => s.date))).toEqual([
        "2026-08-15",
        "2026-09-15",
        "2026-10-15",
        "2026-11-15",
        "2026-12-15",
        "2027-01-15",
        "2027-02-15",
        "2027-03-15",
        "2027-04-15",
        "2027-05-15",
        "2027-06-15",
        "2027-07-15",
      ]);
    });

    it("charges interest on the opening balance and puts the remainder on principal", () => {
      const first = schedule()[0];
      expect(first.interest).toBeCloseTo(monthlyInterestOf(5_000, 24), 10); // 100
      expect(first.principal).toBeCloseTo(400, 10);
      expect(first.remainingBalance).toBeCloseTo(4_600, 10);
    });

    it("keeps cumulativeInterest as a running total of the per-period interest", () => {
      const rows = schedule();
      let running = 0;
      rows.forEach((row) => {
        running += row.interest;
        expect(row.cumulativeInterest).toBeCloseTo(running, 10);
      });
      // Total interest on 5,000 at 2%/month paying 500: 635.16.
      expect(rows[rows.length - 1].cumulativeInterest).toBeCloseTo(635.16, 2);
    });

    it("keeps cumulativePrincipal as a running total of the per-period principal", () => {
      const rows = schedule();
      let running = 0;
      rows.forEach((row) => {
        running += row.principal;
        expect(row.cumulativePrincipal).toBeCloseTo(running, 10);
      });
    });

    it("reduces the remaining balance every month until it reaches zero", () => {
      const rows = schedule();
      expect(strictlyDecreasing(rows.map((r) => r.remainingBalance))).toBe(true);
      expect(rows[rows.length - 1].remainingBalance).toBe(0);
    });

    it("retires exactly the starting balance in principal", () => {
      const rows = schedule();
      expect(sumBy(rows, (r) => r.principal)).toBe(5_000);
      expect(rows[rows.length - 1].cumulativePrincipal).toBeCloseTo(5_000, 6);
    });

    it("trims the final payment to the residual balance plus its interest", () => {
      const rows = schedule();
      const last = rows[rows.length - 1];
      const penultimate = rows[rows.length - 2];
      // 132.513832 remaining + 2.650277 interest = 135.164109, well under the 500 payment.
      expect(last.payment).toBeCloseTo(penultimate.remainingBalance + last.interest, 10);
      expect(last.payment).toBeCloseTo(135.16, 2);
      expect(last.payment).toBeLessThan(500);
    });

    it("charges the full payment every month except the last", () => {
      const rows = schedule();
      expect(paymentsOf(rows.slice(0, -1))).toEqual(Array(11).fill(500));
    });
  });

  describe("zero APR", () => {
    it("applies the whole payment to principal", () => {
      const schedule = calculateCreditCardPayoff(1_000, 0, 300, d("2026-01-15"));
      expect(schedule.map((s) => s.interest)).toEqual([0, 0, 0, 0]);
      expect(schedule.map((s) => s.principal)).toEqual([300, 300, 300, 100]);
      expect(schedule[3].cumulativeInterest).toBe(0);
    });

    it("takes ceil(balance / payment) months", () => {
      // 1,000 / 300 = 3.33 -> 4 payments, the last one a 100 remainder.
      expect(calculateCreditCardPayoff(1_000, 0, 300, d("2026-01-15"))).toHaveLength(
        Math.ceil(1_000 / 300)
      );
      expect(calculateCreditCardPayoff(1_200, 0, 300, d("2026-01-15"))).toHaveLength(
        Math.ceil(1_200 / 300)
      );
    });

    it("advances one calendar month per payment", () => {
      const schedule = calculateCreditCardPayoff(1_000, 0, 300, d("2026-01-15"));
      expect(ymdAll(schedule.map((s) => s.date))).toEqual([
        "2026-01-15",
        "2026-02-15",
        "2026-03-15",
        "2026-04-15",
      ]);
    });
  });

  describe("minimum payment trap (payment below the monthly interest)", () => {
    // 5,000 at 24% accrues 100/month of interest; a 50 payment cannot cover it.
    const trap = () => calculateCreditCardPayoff(5_000, 24, 50, d("2026-01-15"));

    it("clamps principal to zero rather than going negative", () => {
      const rows = trap();
      expect(rows.every((r) => r.principal === 0)).toBe(true);
      expect(rows.every((r) => r.principal >= 0)).toBe(true);
      expect(rows[rows.length - 1].cumulativePrincipal).toBe(0);
    });

    it("holds the balance flat instead of growing it", () => {
      // NOTE: this documents the model, not reality. A real card capitalises the
      // unpaid interest, so the balance would compound upward at ~2%/month. The
      // Math.max(0, ...) clamp on principal means the balance can only ever stay
      // flat, so this projection UNDERSTATES the trap: the user is shown a debt
      // that never grows. See the "known defects" block below.
      const rows = trap();
      expect(rows.every((r) => r.remainingBalance === 5_000)).toBe(true);
    });

    it("still accrues interest every month", () => {
      const rows = trap();
      expect(rows.every((r) => r.interest === 100)).toBe(true);
      // 13 pushed rows x 100 of interest.
      expect(rows[rows.length - 1].cumulativeInterest).toBeCloseTo(1_300, 10);
    });

    it("bails out after month 12 instead of running to maxMonths", () => {
      // The guard is `month > 12 && principal < 0.01`, checked after the push,
      // so month 13 is recorded and then the loop breaks.
      expect(trap()).toHaveLength(13);
      expect(calculateCreditCardPayoff(5_000, 24, 50, d("2026-01-15"), 600)).toHaveLength(13);
    });

    it("charges the unchanged payment every month it does run", () => {
      expect(paymentsOf(trap())).toEqual(Array(13).fill(50));
    });
  });

  describe("maxMonths cap", () => {
    it("stops at maxMonths while the balance is still outstanding", () => {
      // Payment 105 against 100 of monthly interest: 5/month of progress, so the
      // trap guard never fires and only the cap can stop the loop.
      const schedule = calculateCreditCardPayoff(5_000, 24, 105, d("2026-01-15"), 5);
      expect(schedule).toHaveLength(5);
      expect(schedule[4].month).toBe(5);
      expect(schedule[4].remainingBalance).toBeGreaterThan(0);
    });

    it("returns an empty schedule when maxMonths is zero", () => {
      expect(calculateCreditCardPayoff(5_000, 24, 500, d("2026-01-15"), 0)).toEqual([]);
    });

    it("returns an empty schedule for a balance that is already settled", () => {
      expect(calculateCreditCardPayoff(0, 24, 500, d("2026-01-15"))).toEqual([]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT (additional, not on the assigned list): negative amortisation is
     * swallowed. app/lib/logic/creditCardCalculator/payoffCalculator.ts:40-41
     * computes `principal = Math.max(0, payment - interest)` and then
     * `balance = balance - principal`, so when the payment does not cover the
     * interest the shortfall simply vanishes: the balance stays flat forever.
     * Correct behaviour: unpaid interest capitalises, so the balance must GROW
     * (5,000 -> 5,050 with a 50 payment against 100 of interest).
     */
    it.fails("KNOWN DEFECT: grows the balance when the payment does not cover interest", () => {
      const rows = calculateCreditCardPayoff(5_000, 24, 50, d("2026-01-15"));
      expect(rows[0].remainingBalance).toBeCloseTo(5_050, 10);
      expect(rows[1].remainingBalance).toBeGreaterThan(rows[0].remainingBalance);
    });
  });
});

// ============================================================================
// calculateDecliningMinimumPayoff
// ============================================================================

describe("calculateDecliningMinimumPayoff", () => {
  /**
   * 1,000 at 12% APR (1% monthly), minimum = 5% of the balance, floor 25.
   * percent_only: principal is 5% - 1% = 4% of the balance each month, so the
   * balance follows 1000 * 0.96^n and the payment follows 50 * 0.96^(n-1).
   * 50 * 0.96^(n-1) drops under the 25 floor at n = 18.
   */
  const percentOnly = makeCreditConfig({
    currentBalance: 1_000,
    apr: 12,
    minimumPaymentPercent: 5,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_only",
  });

  /**
   * Same card with percent_plus_interest at 3%: the payment is 3% + 1% = 4% of
   * the balance and principal is 3%, so the balance follows 1000 * 0.97^n and
   * the payment follows 40 * 0.97^(n-1), hitting the 25 floor at n = 17.
   */
  const percentPlusInterest = makeCreditConfig({
    currentBalance: 1_000,
    apr: 12,
    minimumPaymentPercent: 3,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_plus_interest",
  });

  describe("percent_only", () => {
    const schedule = () => calculateDecliningMinimumPayoff(percentOnly, d("2026-01-15"));

    it("recomputes the payment from the shrinking balance each month", () => {
      const payments = paymentsOf(schedule());
      // Closed form: payment_n = 50 * 0.96^(n-1) while above the floor.
      [50, 48, 46.08, 44.2368, 42.467328].forEach((expected, i) => {
        expect(payments[i]).toBeCloseTo(expected, 6);
      });
    });

    it("decreases the payment strictly every month until the floor binds", () => {
      const payments = paymentsOf(schedule());
      expect(strictlyDecreasing(payments.slice(0, 17))).toBe(true);
      expect(payments[16]).toBeCloseTo(50 * Math.pow(0.96, 16), 6); // 26.02
    });

    it("holds the payment at the floor once the percentage falls below it", () => {
      const payments = paymentsOf(schedule());
      // Months 18..39 all sit on the 25 floor; month 40 is the trimmed remainder.
      expect(payments.slice(17, 39)).toEqual(Array(22).fill(25));
      expect(payments[39]).toBeLessThan(25);
    });

    it("terminates with the balance fully retired because the floor guarantees progress", () => {
      const rows = schedule();
      expect(rows).toHaveLength(40);
      expect(rows[39].remainingBalance).toBe(0);
      expect(sumBy(rows, (r) => r.principal)).toBe(1_000);
    });

    it("keeps the running totals consistent with the per-period amounts", () => {
      const rows = schedule();
      let interest = 0;
      let principal = 0;
      rows.forEach((row) => {
        interest += row.interest;
        principal += row.principal;
        expect(row.cumulativeInterest).toBeCloseTo(interest, 10);
        expect(row.cumulativePrincipal).toBeCloseTo(principal, 10);
      });
      expect(rows[39].cumulativeInterest).toBeCloseTo(185.67, 2);
    });

    it("advances one calendar month per payment", () => {
      const rows = calculateDecliningMinimumPayoff(percentOnly, d("2026-01-15"), 4);
      expect(ymdAll(rows.map((r) => r.date))).toEqual([
        "2026-01-15",
        "2026-02-15",
        "2026-03-15",
        "2026-04-15",
      ]);
    });
  });

  describe("percent_plus_interest", () => {
    const schedule = () => calculateDecliningMinimumPayoff(percentPlusInterest, d("2026-01-15"));

    it("recomputes percentage plus current interest from the shrinking balance", () => {
      const payments = paymentsOf(schedule());
      // Closed form: payment_n = 40 * 0.97^(n-1) while above the floor.
      [40, 38.8, 37.636, 36.50692, 35.4117124].forEach((expected, i) => {
        expect(payments[i]).toBeCloseTo(expected, 6);
      });
    });

    it("decreases the payment strictly until the floor binds, then holds it", () => {
      const payments = paymentsOf(schedule());
      expect(strictlyDecreasing(payments.slice(0, 16))).toBe(true);
      expect(payments.slice(16, 44)).toEqual(Array(28).fill(25));
    });

    it("terminates with the balance fully retired", () => {
      const rows = schedule();
      expect(rows).toHaveLength(45);
      expect(rows[44].remainingBalance).toBe(0);
      expect(sumBy(rows, (r) => r.principal)).toBe(1_000);
    });
  });

  describe("compared with a fixed payment at the same starting amount", () => {
    // Both start at 50/month on 1,000 at 12%; the declining schedule shrinks its
    // payment as the balance falls, so it pays for far longer and costs more.
    const declining = () => calculateDecliningMinimumPayoff(percentOnly, d("2026-01-15"));
    const fixed = () => calculateCreditCardPayoff(1_000, 12, 50, d("2026-01-15"));

    it("starts both schedules at the same payment", () => {
      expect(declining()[0].payment).toBe(50);
      expect(fixed()[0].payment).toBe(50);
    });

    it("takes more months than holding the payment steady", () => {
      // 40 months declining vs 23 months at a flat 50.
      expect(declining()).toHaveLength(40);
      expect(fixed()).toHaveLength(23);
      expect(declining().length).toBeGreaterThan(fixed().length);
    });

    it("costs more total interest than holding the payment steady", () => {
      const decliningInterest = declining()[39].cumulativeInterest;
      const fixedInterest = fixed()[22].cumulativeInterest;
      expect(decliningInterest).toBeCloseTo(185.67, 2);
      expect(fixedInterest).toBeCloseTo(121.35, 2);
      expect(decliningInterest).toBeGreaterThan(fixedInterest);
    });
  });

  describe("maxMonths cap", () => {
    it("stops at maxMonths while the balance is still outstanding", () => {
      const rows = calculateDecliningMinimumPayoff(percentOnly, d("2026-01-15"), 6);
      expect(rows).toHaveLength(6);
      expect(rows[5].remainingBalance).toBeGreaterThan(0);
    });
  });

  describe("minimum payment trap", () => {
    it("bails out after month 12 when the recomputed minimum only covers interest", () => {
      // 2% of the balance against a 2%/month rate: principal is always 0, so the
      // declining minimum never makes progress either.
      const trapped = makeCreditConfig({
        currentBalance: 5_000,
        apr: 24,
        minimumPaymentPercent: 2,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_only",
      });
      const rows = calculateDecliningMinimumPayoff(trapped, d("2026-01-15"), 600);
      expect(rows).toHaveLength(13);
      expect(rows.every((r) => r.remainingBalance === 5_000)).toBe(true);
    });
  });
});

// ============================================================================
// generateCreditProjections
// ============================================================================

describe("generateCreditProjections", () => {
  const window = { start: d("2026-01-01"), end: d("2026-06-30") };

  /** A card that actually pays itself down: 5,000 at 24%, flat 500/month. */
  const fixedCard = (
    ruleOverrides: Parameters<typeof makeCreditRule>[0] = {},
    creditOverrides: Partial<CreditConfig> = {}
  ) =>
    makeCreditRule(
      { startDate: "2026-01-01", ...ruleOverrides },
      {
        currentBalance: 5_000,
        apr: 24,
        dueDate: 15,
        paymentStrategy: "fixed",
        fixedPaymentAmount: 500,
        ...creditOverrides,
      }
    );

  /** A card on the declining minimum: 1,000 at 12%, 5% minimum, floor 25. */
  const minimumCard = (creditOverrides: Partial<CreditConfig> = {}) =>
    makeCreditRule(
      { startDate: "2026-01-01" },
      {
        currentBalance: 1_000,
        apr: 12,
        dueDate: 15,
        minimumPaymentPercent: 5,
        minimumPaymentFloor: 25,
        minimumPaymentMethod: "percent_only",
        paymentStrategy: "minimum",
        ...creditOverrides,
      }
    );

  describe("guards", () => {
    it("returns nothing when the rule carries no credit configuration", () => {
      const rule = makeCreditRule({ startDate: "2026-01-01", creditConfig: undefined });
      expect(generateCreditProjections(rule, window.start, window.end)).toEqual([]);
    });

    it("returns nothing for a fully paid card", () => {
      expect(
        generateCreditProjections(fixedCard({}, { currentBalance: 0 }), window.start, window.end)
      ).toEqual([]);
    });

    it("returns nothing for a credit balance (negative outstanding amount)", () => {
      expect(
        generateCreditProjections(fixedCard({}, { currentBalance: -250 }), window.start, window.end)
      ).toEqual([]);
    });
  });

  describe("payment dates", () => {
    it("schedules every payment on the configured due date", () => {
      const result = generateCreditProjections(
        fixedCard({}, { dueDate: 9 }),
        window.start,
        window.end
      );
      expect(result.map((t) => t.scheduledDate)).toEqual([
        "2026-01-09",
        "2026-02-09",
        "2026-03-09",
        "2026-04-09",
        "2026-05-09",
        "2026-06-09",
      ]);
    });

    it("moves the first payment to the next month when the due date already passed", () => {
      // Rule starts 2026-01-20 but the card is due on the 15th, so January is gone.
      const result = generateCreditProjections(
        fixedCard({ startDate: "2026-01-20" }, { dueDate: 15 }),
        window.start,
        window.end
      );
      expect(result.map((t) => t.scheduledDate)).toEqual([
        "2026-02-15",
        "2026-03-15",
        "2026-04-15",
        "2026-05-15",
        "2026-06-15",
      ]);
    });

    it("clamps a due date past the end of a short month to that month's last day", () => {
      // Due on the 31st, but April only has 30 days.
      const result = generateCreditProjections(
        fixedCard({}, { dueDate: 31 }),
        d("2026-04-01"),
        d("2026-04-30")
      );
      expect(result.map((t) => t.scheduledDate)).toEqual(["2026-04-30"]);
    });
  });

  describe("strategy routing", () => {
    it("uses the declining-minimum schedule for the minimum strategy", () => {
      const result = generateCreditProjections(minimumCard(), window.start, window.end);
      const amounts = result.map((t) => t.projectedAmount);
      // 50 * 0.96^(n-1): the payment shrinks with the balance.
      [50, 48, 46.08, 44.2368, 42.467328, 40.76863488].forEach((expected, i) => {
        expect(amounts[i]).toBeCloseTo(expected, 6);
      });
      expect(strictlyDecreasing(amounts)).toBe(true);
    });

    it("uses a level payment for the fixed strategy", () => {
      const result = generateCreditProjections(fixedCard(), window.start, window.end);
      expect(result.map((t) => t.projectedAmount)).toEqual([500, 500, 500, 500, 500, 500]);
    });

    it("falls back to the minimum payment when the fixed strategy has no amount", () => {
      const result = generateCreditProjections(
        fixedCard({}, { fixedPaymentAmount: undefined, minimumPaymentPercent: 4 }),
        window.start,
        window.end
      );
      // 4% of 5,000 = 200, held level because the fixed branch does not recompute.
      expect(result.map((t) => t.projectedAmount)).toEqual([200, 200, 200, 200, 200, 200]);
    });

    it("charges the whole outstanding balance for the full_balance strategy", () => {
      const result = generateCreditProjections(
        fixedCard({}, { paymentStrategy: "full_balance" }),
        window.start,
        window.end
      );
      expect(result[0].projectedAmount).toBe(5_000);
      expect(result[0].scheduledDate).toBe("2026-01-15");
    });

    it("marks projections as projected expenses sourced from the rule", () => {
      const result = generateCreditProjections(fixedCard(), window.start, window.end);
      expect(result[0]).toMatchObject({
        name: "Visa",
        type: "expense",
        category: "debt_payment",
        sourceType: "expense_rule",
        sourceId: "card-1",
        status: "projected",
      });
    });
  });

  describe("payment breakdown", () => {
    it("carries the principal, interest and remaining balance of each period", () => {
      const result = generateCreditProjections(fixedCard(), window.start, window.end);
      // 5,000 at 2%/month: interest 100, principal 400, balance 4,600.
      expect(result[0].paymentBreakdown).toMatchObject({
        principalPaid: 400,
        interestPaid: 100,
        remainingBalance: 4_600,
      });
      // Month 2: interest 92 on 4,600, principal 408, balance 4,192.
      expect(result[1].paymentBreakdown?.interestPaid).toBeCloseTo(92, 10);
      expect(result[1].paymentBreakdown?.principalPaid).toBeCloseTo(408, 10);
      expect(result[1].paymentBreakdown?.remainingBalance).toBeCloseTo(4_192, 10);
    });

    it("sets paymentNumber from the schedule month, not the position in the window", () => {
      const result = generateCreditProjections(fixedCard(), d("2026-04-01"), d("2026-06-30"));
      expect(result.map((t) => t.scheduledDate)).toEqual([
        "2026-04-15",
        "2026-05-15",
        "2026-06-15",
      ]);
      // The window starts at the 4th payment, so numbering must continue at 4.
      expect(result.map((t) => t.paymentBreakdown?.paymentNumber)).toEqual([4, 5, 6]);
    });

    it("projects an amount equal to principal plus interest", () => {
      const result = generateCreditProjections(minimumCard(), window.start, window.end);
      result.forEach((t) => {
        const breakdown = t.paymentBreakdown!;
        expect(t.projectedAmount).toBeCloseTo(breakdown.principalPaid + breakdown.interestPaid, 10);
      });
    });
  });

  describe("view window", () => {
    it("emits only the payments inside the requested window", () => {
      const result = generateCreditProjections(fixedCard(), d("2026-02-16"), d("2026-04-30"));
      expect(result.map((t) => t.scheduledDate)).toEqual(["2026-03-15", "2026-04-15"]);
    });

    it("emits nothing for a window that ends before the first payment", () => {
      expect(generateCreditProjections(fixedCard(), d("2025-01-01"), d("2025-12-31"))).toEqual([]);
    });

    it("emits nothing for a window that starts after the card is retired", () => {
      // 5,000 at 500/month is gone after 12 payments (through 2026-12-15).
      expect(generateCreditProjections(fixedCard(), d("2027-06-01"), d("2027-12-31"))).toEqual([]);
    });
  });

  describe("occurrence overrides", () => {
    it("stamps a stable monthly occurrence id on every payment", () => {
      const result = generateCreditProjections(fixedCard(), window.start, window.end);
      expect(result.map((t) => t.occurrenceId)).toEqual([
        "card-1_2026-01",
        "card-1_2026-02",
        "card-1_2026-03",
        "card-1_2026-04",
        "card-1_2026-05",
        "card-1_2026-06",
      ]);
    });

    it("applies an amount override to the matching occurrence only", () => {
      const rule = fixedCard({
        occurrenceOverrides: { "card-1_2026-03": { amount: 1_234.56 } },
      });
      const result = generateCreditProjections(rule, window.start, window.end);
      expect(result.map((t) => t.projectedAmount)).toEqual([500, 500, 1_234.56, 500, 500, 500]);
    });

    it("drops an occurrence marked as skipped", () => {
      const rule = fixedCard({
        occurrenceOverrides: { "card-1_2026-03": { skipped: true } },
      });
      const result = generateCreditProjections(rule, window.start, window.end);
      expect(result.map((t) => t.scheduledDate)).toEqual([
        "2026-01-15",
        "2026-02-15",
        "2026-04-15",
        "2026-05-15",
        "2026-06-15",
      ]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT 1: totalPayments is hardcoded to 0.
     * app/lib/logic/projectionEngine/creditProjections.ts:98 writes
     * `totalPayments: 0` into every paymentBreakdown, so any UI rendering
     * "payment N of M" has no M. Correct behaviour: the length of the payoff
     * schedule (here 4, since 1,200 at 0% APR paying 300/month takes exactly
     * four payments).
     */
    it.fails("KNOWN DEFECT: reports the total number of payments in the schedule", () => {
      const result = generateCreditProjections(
        fixedCard({}, { currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 }),
        window.start,
        window.end
      );
      expect(result.map((t) => t.paymentBreakdown?.paymentNumber)).toEqual([1, 2, 3, 4]);
      expect(result.map((t) => t.paymentBreakdown?.totalPayments)).toEqual([4, 4, 4, 4]);
    });

    /**
     * DEFECT 2: the card balance is never reduced as payments complete.
     * Loans and instalments record progress (LoanConfig.paymentsMade,
     * InstallmentConfig.installmentsPaid) and the completion path in
     * app/contexts/FinancialContext/actions/transactionActions.ts
     * (markTransactionCompleteAction, ~lines 122-140) writes those fields back —
     * but it has no creditConfig branch at all, and CreditConfig has no progress
     * field for it to write. generateCreditProjections therefore always restarts
     * from creditConfig.currentBalance, so the same schedule is re-projected
     * forever no matter how many payments the user has completed.
     * Correct behaviour: once the first of four payments is done, three remain
     * and the first projected remaining balance reflects the reduced debt.
     * This test feeds the only progress marker the codebase has (paymentsMade,
     * as used by LoanConfig) and asserts the schedule shortens.
     */
    it.fails("KNOWN DEFECT: shortens the schedule once a payment has been completed", () => {
      const config: Partial<CreditConfig> = {
        currentBalance: 1_200,
        apr: 0,
        fixedPaymentAmount: 300,
      };
      const before = generateCreditProjections(fixedCard({}, config), window.start, window.end);
      expect(before).toHaveLength(4);

      const afterOnePayment = generateCreditProjections(
        fixedCard({}, { ...config, paymentsMade: 1 } as Partial<CreditConfig>),
        window.start,
        window.end
      );
      // Three payments of 300 should remain, opening at a 900 balance.
      expect(afterOnePayment).toHaveLength(3);
      expect(afterOnePayment[0].paymentBreakdown?.remainingBalance).toBe(600);
    });

    /**
     * DEFECT 3: the first payment date rolls into the following month.
     * app/lib/logic/projectionEngine/creditProjections.ts:34-35 does
     * `firstPaymentDate.setDate(creditConfig.dueDate)` with no clamping, so a
     * due date of 31 in a 30-day month overflows to the 1st of the NEXT month
     * (JS Date arithmetic). The clamp on lines 40-45 only runs in the
     * "due date already passed" branch, which this case never enters.
     * Correct behaviour: a rule starting 2026-04-10 with a due date of 31 must
     * schedule its first payment on 2026-04-30, not 2026-05-31.
     */
    it.fails("KNOWN DEFECT: keeps the first payment inside the rule's start month", () => {
      const result = generateCreditProjections(
        fixedCard({ startDate: "2026-04-10" }, { dueDate: 31 }),
        d("2026-04-01"),
        d("2026-08-31")
      );
      expect(result[0].scheduledDate).toBe("2026-04-30");
      expect(result[0].occurrenceId).toBe("card-1_2026-04");
    });

    /**
     * DEFECT (additional): a due date after the 28th makes the schedule skip
     * February entirely. payoffCalculator.ts:57 advances with
     * `currentDate.setMonth(currentDate.getMonth() + 1)`, which overflows
     * 2026-01-31 to 2026-03-03 instead of clamping to 2026-02-28. The clamp in
     * creditProjections.ts:72-77 then rounds 2026-03-03 to 2026-03-31, so the
     * user is shown no February payment at all (and the day-of-month silently
     * drifts to the 3rd for every later month).
     * Correct behaviour: one payment per calendar month, February clamped to the
     * 28th.
     */
    it.fails("KNOWN DEFECT: still bills February when the due date is the 31st", () => {
      const result = generateCreditProjections(
        fixedCard({}, { dueDate: 31 }),
        d("2026-01-01"),
        d("2026-03-31")
      );
      expect(result.map((t) => t.scheduledDate)).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
      ]);
    });

    /**
     * DEFECT (additional): payments can be emitted outside the requested window.
     * creditProjections.ts:68 filters on the raw schedule date but line 71-77
     * then moves the date to the due date, after the filter has run. With a due
     * date of 31 the drifted schedule date 2026-03-03 passes a window ending
     * 2026-03-10 and is then pushed out to 2026-03-31.
     * Correct behaviour: no projected transaction is dated after viewEndDate.
     */
    it.fails("KNOWN DEFECT: never emits a payment dated after the end of the window", () => {
      const result = generateCreditProjections(
        fixedCard({}, { dueDate: 31 }),
        d("2026-01-01"),
        d("2026-03-10")
      );
      expect(result.every((t) => t.scheduledDate <= "2026-03-10")).toBe(true);
    });

    /**
     * DEFECT (additional): the full_balance strategy does not retire the card.
     * getEffectivePayment returns exactly currentBalance, but
     * calculateCreditCardPayoff charges that month's interest first, leaving the
     * interest unpaid — so a 5,000 balance at 24% pays 5,000 and then needs a
     * second payment of 102 the following month.
     * Correct behaviour: "pay the full balance" clears the card in one payment.
     */
    it.fails("KNOWN DEFECT: retires the card in a single payment for full_balance", () => {
      const result = generateCreditProjections(
        fixedCard({}, { paymentStrategy: "full_balance" }),
        window.start,
        window.end
      );
      expect(result).toHaveLength(1);
      expect(result[0].paymentBreakdown?.remainingBalance).toBe(0);
    });

    /**
     * DEFECT (additional): a card whose minimum payment cannot cover its
     * interest is projected for exactly 13 months and then stops. The trap guard
     * in payoffCalculator.ts:128-130 breaks out of the loop, so the calendar
     * shows the debt quietly disappearing after 13 payments instead of
     * continuing (or being flagged) forever.
     * Correct behaviour: the projection keeps billing the minimum for as long as
     * the window asks — a trapped card does not stop having a payment due.
     */
    it.fails("KNOWN DEFECT: keeps projecting payments for a trapped minimum-payment card", () => {
      // 2% minimum against a 2%/month rate: principal is always zero.
      const result = generateCreditProjections(
        minimumCard({ currentBalance: 5_000, apr: 24, minimumPaymentPercent: 2 }),
        d("2026-01-01"),
        d("2027-12-31")
      );
      // 24 months of window, 24 payments due.
      expect(result).toHaveLength(24);
    });
  });
});
