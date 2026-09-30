import { describe, expect, it } from "vitest";
import {
  calculateCreditCardPayoff,
  calculateDecliningMinimumPayoff,
  calculateFullBalancePayoff,
} from "@/lib/logic/creditCardCalculator/payoffCalculator";
import {
  calculateMinimumPayment,
  calculatePaymentForMonths,
  getEffectivePayment,
} from "@/lib/logic/creditCardCalculator/paymentCalculator";
import { calculatePayoffSummary } from "@/lib/logic/creditCardCalculator/summaryCalculator";
import { makeCreditConfig } from "../helpers/builders";
import { d, ymdAll } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * D3 - the credit-card minimum-payment trap.
 *
 * VERDICT (see docs/audit/fixes/debt.md): the clamp IS a bug. A schedule must obey
 *   remaining = opening + cumulative interest - cumulative paid
 * at every row. With a payment below the monthly interest the old loop charged the
 * interest in `cumulativeInterest` but never added it to the balance, so money vanished
 * from the books. The numbers below are hand-derived and independent of the app.
 */

type Row = {
  payment: number;
  principal: number;
  interest: number;
  remainingBalance: number;
  cumulativeInterest: number;
  cumulativePrincipal: number;
};

/** The conservation identity, row by row. */
const expectConserved = (opening: number, rows: Row[]) => {
  let paid = 0;
  rows.forEach((row) => {
    paid += row.payment;
    expect(row.remainingBalance).toBeCloseTo(opening + row.cumulativeInterest - paid, 6);
    expect(row.principal).toBeCloseTo(row.payment - row.interest, 9);
  });
};

describe("D3: a payment below the monthly interest compounds (5,000 @ 24% = 2%/month, paying 50)", () => {
  // Hand derivation, balance before payment b, interest 2% b, payment 50, balance after = 1.02 b - 50:
  //   month 1: interest 100.00 -> 5,050.00
  //   month 2: interest 101.00 -> 5,101.00
  //   month 3: interest 102.02 -> 5,153.02
  const rows = calculateCreditCardPayoff(5_000, 24, 50, d("2026-01-15"), 24);

  it("grows the balance 5,050.00 -> 5,101.00 -> 5,153.02", () => {
    expect(rows[0].remainingBalance).toBeCloseTo(5_050, 9);
    expect(rows[1].remainingBalance).toBeCloseTo(5_101, 9);
    expect(rows[2].remainingBalance).toBeCloseTo(5_153.02, 9);
  });

  it("reports the shortfall as negative principal (-50.00, -51.00, -52.02)", () => {
    expect(rows[0].principal).toBeCloseTo(-50, 9);
    expect(rows[1].principal).toBeCloseTo(-51, 9);
    expect(rows[2].principal).toBeCloseTo(-52.02, 9);
    expect(rows[2].cumulativePrincipal).toBeCloseTo(-153.02, 9);
  });

  it("charges 100.00, 201.00, 303.02 of cumulative interest", () => {
    expect(rows[0].cumulativeInterest).toBeCloseTo(100, 9);
    expect(rows[1].cumulativeInterest).toBeCloseTo(201, 9);
    expect(rows[2].cumulativeInterest).toBeCloseTo(303.02, 9);
  });

  it("conserves money on every row (opening + interest - paid)", () => {
    expectConserved(5_000, rows);
  });

  it("is NOT truncated after month 12/13: it runs as long as it is asked to (24 rows here)", () => {
    expect(rows).toHaveLength(24);
  });

  it("runs to the 600-month default horizon when never paid off", () => {
    expect(calculateCreditCardPayoff(5_000, 24, 50, d("2026-01-15"))).toHaveLength(600);
  });
});

describe("D3: a payment exactly equal to the interest holds the balance flat and conserves money", () => {
  // 5,000 @ 24% = 100.00 a month; paying 100 leaves principal 0 and a flat balance.
  const rows = calculateCreditCardPayoff(5_000, 24, 100, d("2026-01-15"), 36);

  it("stays at 5,000 with zero principal", () => {
    rows.forEach((row) => {
      expect(row.remainingBalance).toBeCloseTo(5_000, 9);
      expect(row.principal).toBeCloseTo(0, 9);
    });
  });

  it("still conserves money", () => {
    expectConserved(5_000, rows);
  });
});

describe("D3: the declining minimum compounds when the percentage is below the monthly rate", () => {
  // 5,000 @ 24%: 1% minimum (floor 25) against 2% monthly interest.
  //   month 1: payment max(25, 50.00) = 50.00, interest 100.00 -> 5,050.00
  //   month 2: payment max(25, 50.50) = 50.50, interest 101.00 -> 5,050 + 101 - 50.50 = 5,100.50
  //   month 3: payment 51.005,  interest 102.01 -> 5,100.50 + 102.01 - 51.005 = 5,151.505
  const config = makeCreditConfig({
    currentBalance: 5_000,
    apr: 24,
    minimumPaymentPercent: 1,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_only",
    paymentStrategy: "minimum",
  });
  const rows = calculateDecliningMinimumPayoff(config, d("2026-01-15"), 36);

  it("grows 5,050.00 -> 5,100.50 -> 5,151.505", () => {
    expect(rows[0].remainingBalance).toBeCloseTo(5_050, 9);
    expect(rows[1].remainingBalance).toBeCloseTo(5_100.5, 9);
    expect(rows[2].remainingBalance).toBeCloseTo(5_151.505, 9);
  });

  it("conserves money on every row and is not truncated at 13", () => {
    expect(rows).toHaveLength(36);
    expectConserved(5_000, rows);
  });
});

describe("a schedule that does pay off still ends at exactly 0 and conserves money", () => {
  it("fixed 500/month on 5,000 @ 24%", () => {
    const rows = calculateCreditCardPayoff(5_000, 24, 500, d("2026-01-15"));
    expect(rows).toHaveLength(12);
    expect(rows[11].remainingBalance).toBe(0);
    expectConserved(5_000, rows);
  });
});

describe("schedule dates step from a fixed anchor (no setMonth overflow)", () => {
  it("fixed payment from Jan 31: Jan 31, Feb 28, Mar 31, Apr 30", () => {
    const rows = calculateCreditCardPayoff(400, 0, 100, d("2026-01-31"));
    expect(ymdAll(rows.map((r) => (r as unknown as { date: Date }).date))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("declining minimum from Jan 30: Jan 30, Feb 28, Mar 30", () => {
    const config = makeCreditConfig({
      currentBalance: 10_000,
      apr: 0,
      minimumPaymentPercent: 50,
      minimumPaymentFloor: 25,
    });
    const rows = calculateDecliningMinimumPayoff(config, d("2026-01-30"), 3);
    expect(ymdAll(rows.map((r) => (r as unknown as { date: Date }).date))).toEqual([
      "2026-01-30",
      "2026-02-28",
      "2026-03-30",
    ]);
  });

  it("does not mutate the start date", () => {
    const start = d("2026-01-31");
    calculateCreditCardPayoff(400, 0, 100, start);
    expect(start.getTime()).toBe(d("2026-01-31").getTime());
  });
});

describe("full_balance: paying the statement balance in full incurs no interest (grace period)", () => {
  // 5,000 @ 24%: the statement balance is cleared in ONE payment of exactly 5,000.00.
  const rows = calculateFullBalancePayoff(5_000, d("2026-01-15"));

  it("is a single payment of the balance, zero interest, zero left", () => {
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      month: 1,
      payment: 5_000,
      principal: 5_000,
      interest: 0,
      remainingBalance: 0,
      cumulativeInterest: 0,
      cumulativePrincipal: 5_000,
    });
  });

  it("is empty for a settled card or a NaN balance", () => {
    expect(calculateFullBalancePayoff(0, d("2026-01-15"))).toEqual([]);
    expect(calculateFullBalancePayoff(NaN, d("2026-01-15"))).toEqual([]);
  });

  it("the summary says: 1 month, 5,000 total, 0 interest, no scenarios", () => {
    freezeToday("2026-03-15");
    const summary = calculatePayoffSummary(
      makeCreditConfig({ currentBalance: 5_000, apr: 24, paymentStrategy: "full_balance" })
    );
    expect(summary.monthsToPayoff).toBe(1);
    expect(summary.totalAmountToPay).toBe(5_000);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.isMinimumPaymentTrap).toBe(false);
    // nothing to save against a baseline that already costs no interest
    expect(summary.scenarios).toEqual([]);
  });
});

describe("D3: scenario savings against a card that never pays off", () => {
  // 5,000 @ 24%, 2% minimum (= the 100.00 monthly interest exactly): the balance never falls.
  const trap = () =>
    makeCreditConfig({
      currentBalance: 5_000,
      apr: 24,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: 25,
      minimumPaymentMethod: "percent_only",
      paymentStrategy: "minimum",
    });

  it("the summary calls the debt endless", () => {
    freezeToday("2026-03-15");
    const summary = calculatePayoffSummary(trap());
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.totalInterestToPay).toBe(Infinity);
    expect(summary.payoffDate).toBeNull();
  });

  it("doubling to 200.00 retires it: n = ln(2)/ln(1.02) = 35.003 -> 36 payments, and the saving is unbounded", () => {
    freezeToday("2026-03-15");
    const scenario = calculatePayoffSummary(trap()).scenarios.find((s) => s.name === "Double Payment");
    expect(scenario).toBeDefined();
    expect(scenario!.monthlyPayment).toBe(200);
    expect(scenario!.monthsToPayoff).toBe(36);
    // finite cost of the alternative
    expect(Number.isFinite(scenario!.totalInterest)).toBe(true);
    // against an endless baseline the saving is unbounded, not "626 and one month"
    expect(scenario!.interestSavings).toBe(Infinity);
    expect(scenario!.timeSavingsMonths).toBe(Infinity);
  });

  it("every scenario's own cost fields stay finite (only the two savings are unbounded)", () => {
    freezeToday("2026-03-15");
    const scenarios = calculatePayoffSummary(trap()).scenarios;
    expect(scenarios.length).toBeGreaterThan(0);
    scenarios.forEach((s) => {
      expect(Number.isFinite(s.monthlyPayment)).toBe(true);
      expect(Number.isFinite(s.monthsToPayoff)).toBe(true);
      expect(Number.isFinite(s.totalInterest)).toBe(true);
      expect(Number.isFinite(s.totalAmount)).toBe(true);
    });
  });

  it("a card that compounds (payment 50 < interest 100) is also endless and gets finite alternatives with unbounded savings", () => {
    freezeToday("2026-03-15");
    const summary = calculatePayoffSummary(
      makeCreditConfig({
        currentBalance: 5_000,
        apr: 24,
        paymentStrategy: "fixed",
        fixedPaymentAmount: 50,
      })
    );
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.isMinimumPaymentTrap).toBe(true);
    const oneYear = summary.scenarios.find((s) => s.name === "Pay Off in 1 Year");
    // PMT(5000, 2%, 12) = 472.80 (rounded up to the cent)
    expect(oneYear?.monthlyPayment).toBeCloseTo(472.8, 2);
    expect(oneYear?.monthsToPayoff).toBe(12);
    expect(oneYear?.interestSavings).toBe(Infinity);
  });

  it("with a finite baseline the saving is the real difference (hand check: 1,000 @ 12%, 100/month vs 200/month)", () => {
    freezeToday("2026-03-15");
    // reference simulation written here, not the app's
    const simulate = (balance: number, payment: number) => {
      let interestTotal = 0;
      let months = 0;
      while (balance > 0.01) {
        const interest = balance * 0.01;
        interestTotal += interest;
        balance = balance + interest - Math.min(payment, balance + interest);
        months++;
      }
      return { interestTotal, months };
    };
    const base = simulate(1_000, 100);
    const dbl = simulate(1_000, 200);
    const summary = calculatePayoffSummary(
      makeCreditConfig({ currentBalance: 1_000, apr: 12, paymentStrategy: "fixed", fixedPaymentAmount: 100 })
    );
    const scenario = summary.scenarios.find((s) => s.name === "Double Payment")!;
    expect(summary.monthsToPayoff).toBe(base.months);
    expect(scenario.monthsToPayoff).toBe(dbl.months);
    expect(scenario.interestSavings).toBeCloseTo(base.interestTotal - dbl.interestTotal, 6);
    expect(scenario.timeSavingsMonths).toBe(base.months - dbl.months);
  });
});

describe("a settled card (balance 0) reports paid off, not Infinity or a trap", () => {
  it("minimum strategy: 0 months, 0 to pay, 0 interest, dated today, not a trap", () => {
    freezeToday("2026-03-15");
    const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance: 0 }));
    expect(summary.monthsToPayoff).toBe(0);
    expect(summary.totalAmountToPay).toBe(0);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.yearsToPayoff).toBe(0);
    expect(summary.payoffDate).not.toBeNull();
    expect(summary.isMinimumPaymentTrap).toBe(false);
    expect(summary.scenarios).toEqual([]);
  });

  it("full_balance strategy: effective payment 0 and still not flagged as a trap", () => {
    const summary = calculatePayoffSummary(
      makeCreditConfig({ currentBalance: 0, paymentStrategy: "full_balance" })
    );
    expect(summary.effectiveMonthlyPayment).toBe(0);
    expect(summary.isMinimumPaymentTrap).toBe(false);
  });

  it("negative or NaN balances are settled too", () => {
    [-10, NaN].forEach((currentBalance) => {
      const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance }));
      expect(summary.monthsToPayoff).toBe(0);
      expect(Number.isNaN(summary.totalAmountToPay)).toBe(false);
    });
  });
});

describe("blank / NaN inputs never produce NaN (math-layer guards)", () => {
  const finite = (x: number) => Number.isFinite(x);

  it("minimum payment with a NaN percent and/or floor is finite", () => {
    // NaN percent counts as 0% and NaN floor as 0: 0 payment, not NaN
    const cfg = makeCreditConfig({ currentBalance: 5_000, minimumPaymentPercent: NaN, minimumPaymentFloor: 25 });
    expect(calculateMinimumPayment(cfg)).toBe(25);
    const both = makeCreditConfig({ currentBalance: 5_000, minimumPaymentPercent: NaN, minimumPaymentFloor: NaN });
    expect(calculateMinimumPayment(both)).toBe(0);
    const plusInterest = makeCreditConfig({
      currentBalance: 5_000,
      apr: NaN,
      minimumPaymentPercent: 2,
      minimumPaymentFloor: NaN,
      minimumPaymentMethod: "percent_plus_interest",
    });
    // 2% of 5,000 = 100; NaN apr = no interest; NaN floor = 0
    expect(calculateMinimumPayment(plusInterest)).toBe(100);
  });

  it("the schedule and summary built from a card with blank optional fields are all finite where they claim to be", () => {
    freezeToday("2026-03-15");
    const cfg = makeCreditConfig({
      currentBalance: 5_000,
      apr: 12,
      minimumPaymentPercent: NaN,
      minimumPaymentFloor: NaN,
    });
    const rows = calculateDecliningMinimumPayoff(cfg, d("2026-03-15"), 12);
    rows.forEach((r) => {
      [r.payment, r.principal, r.interest, r.remainingBalance].forEach((x) => expect(finite(x)).toBe(true));
    });
    const summary = calculatePayoffSummary(cfg);
    expect(Number.isNaN(summary.effectiveMonthlyPayment)).toBe(false);
    expect(Number.isNaN(summary.currentMonthlyInterest)).toBe(false);
  });

  it("a fixed strategy with a NaN amount falls back to the minimum", () => {
    const cfg = makeCreditConfig({ currentBalance: 5_000, paymentStrategy: "fixed", fixedPaymentAmount: NaN });
    expect(getEffectivePayment(cfg)).toBe(100); // 2% of 5,000
  });

  it("calculatePaymentForMonths with 0 or negative months is 0, not Infinity", () => {
    expect(calculatePaymentForMonths(1_000, 12, 0)).toBe(0);
    expect(calculatePaymentForMonths(1_000, 0, 0)).toBe(0);
    expect(calculatePaymentForMonths(1_000, 12, -2)).toBe(0);
    expect(calculatePaymentForMonths(0, 12, 12)).toBe(0);
  });
});
