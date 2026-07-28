import { describe, it, expect, beforeEach } from "vitest";
import type { CreditConfig } from "@/lib/types";
import type {
  CreditCardPayoffSummary,
  PayoffScenario,
} from "@/lib/logic/creditCardCalculator/types";
import { calculatePayoffSummary } from "@/lib/logic/creditCardCalculator/summaryCalculator";
import { calculatePayoffScenarios } from "@/lib/logic/creditCardCalculator/scenarioCalculator";
import {
  calculateCreditCardPayoff,
  calculateDecliningMinimumPayoff,
} from "@/lib/logic/creditCardCalculator/payoffCalculator";
import {
  getEffectivePayment,
  calculatePaymentForMonths,
} from "@/lib/logic/creditCardCalculator/paymentCalculator";
import { makeCreditConfig } from "../helpers/builders";
import { d, ymd } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * The summary/scenario layer of the credit card calculator — the payoff advice
 * ExpenseRuleDetail.tsx:62 renders.
 *
 * The schedule primitives underneath (calculateCreditCardPayoff,
 * calculateDecliningMinimumPayoff, calculateMinimumPayment,
 * getEffectivePayment, calculatePaymentForMonths, formatPayoffTime) are covered
 * in tests/unit/creditCards.test.ts and are NOT re-covered here. They are called
 * from this file only as independent oracles: this suite asserts what the
 * summary/scenario layer does WITH them — routing, aggregation, the trap flag,
 * savings baselines and the scenario filter.
 *
 * Both layers date their schedules from `new Date()`, so the clock is frozen for
 * every test. Day 15 is chosen because `Date.setMonth` (used to advance the
 * schedule) overflows past the 28th.
 */

const TODAY = "2026-03-15";

beforeEach(() => {
  freezeToday(TODAY);
});

// ============================================================================
// Local helpers
// ============================================================================

/**
 * Local calendar arithmetic, deliberately not the app's dayjs helpers: the
 * payoff date must be checked against an independent month-adder.
 */
const addMonths = (from: string, months: number): string => {
  const [y, m, day] = from.split("-").map(Number);
  return ymd(new Date(y, m - 1 + months, day));
};

/** Independently computed one month of interest (not the production expression). */
const monthlyInterestOf = (balance: number, apr: number): number => (balance * (apr / 100)) / 12;

/** Sum of a schedule's payments, recomputed rather than read off the summary. */
const paidOver = (schedule: { payment: number }[]): number =>
  schedule.reduce((total, row) => total + row.payment, 0);

/** Sum of a schedule's per-period interest, independent of `cumulativeInterest`. */
const interestOver = (schedule: { interest: number }[]): number =>
  schedule.reduce((total, row) => total + row.interest, 0);

const byName = (scenarios: PayoffScenario[], name: string): PayoffScenario | undefined =>
  scenarios.find((scenario) => scenario.name === name);

const numericFieldsOf = (scenario: PayoffScenario): [string, number][] => [
  ["monthlyPayment", scenario.monthlyPayment],
  ["monthsToPayoff", scenario.monthsToPayoff],
  ["totalInterest", scenario.totalInterest],
  ["totalAmount", scenario.totalAmount],
  ["interestSavings", scenario.interestSavings],
  ["timeSavingsMonths", scenario.timeSavingsMonths],
];

/** "<scenario>.<field>" for every scenario field that is NaN or infinite. */
const nonFiniteScenarioFields = (scenarios: PayoffScenario[]): string[] =>
  scenarios.flatMap((scenario) =>
    numericFieldsOf(scenario)
      .filter(([, value]) => !Number.isFinite(value))
      .map(([field]) => `${scenario.name}.${field}`)
  );

/**
 * Summary fields that are NaN. Infinity is excluded on purpose — the summary
 * uses it as a deliberate sentinel for "never pays off" — but NaN is never a
 * legitimate answer for any of them.
 */
const nanSummaryFields = (summary: CreditCardPayoffSummary): string[] =>
  (
    [
      "monthsToPayoff",
      "totalAmountToPay",
      "totalInterestToPay",
      "currentMonthlyInterest",
      "effectiveMonthlyPayment",
      "principalPaidSoFar",
      "interestPaidSoFar",
      "yearsToPayoff",
    ] as const
  ).filter((field) => Number.isNaN(summary[field]));

// ============================================================================
// Fixtures
// ============================================================================

/**
 * The minimum-payment trap, exactly: 5,000 at 24% APR accrues 100/month of
 * interest and the 2% minimum is also exactly 100, so no payment ever touches
 * principal. `calculateDecliningMinimumPayoff` records 13 rows and bails out.
 */
const trapCard = (overrides: Partial<CreditConfig> = {}): CreditConfig =>
  makeCreditConfig({
    currentBalance: 5_000,
    apr: 24,
    minimumPaymentPercent: 2,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_only",
    paymentStrategy: "minimum",
    ...overrides,
  });

/**
 * A card that does retire itself on the declining minimum: 1,000 at 12% APR
 * (1%/month), minimum 5% of the balance with a 25 floor. 40 payments, 185.671
 * of interest (pinned in creditCards.test.ts).
 */
const decliningCard = (overrides: Partial<CreditConfig> = {}): CreditConfig =>
  makeCreditConfig({
    currentBalance: 1_000,
    apr: 12,
    minimumPaymentPercent: 5,
    minimumPaymentFloor: 25,
    minimumPaymentMethod: "percent_only",
    paymentStrategy: "minimum",
    ...overrides,
  });

/** 5,000 at 24% on a flat 500/month: 12 payments, 635.164 of interest. */
const fixedCard = (overrides: Partial<CreditConfig> = {}): CreditConfig =>
  makeCreditConfig({
    currentBalance: 5_000,
    apr: 24,
    paymentStrategy: "fixed",
    fixedPaymentAmount: 500,
    ...overrides,
  });

// ============================================================================
// calculatePayoffSummary — strategy routing
// ============================================================================

describe("calculatePayoffSummary: strategy routing", () => {
  it("routes the minimum strategy to the declining-minimum schedule", () => {
    // The discriminator: a FLAT 50/month on this card would retire it in 23
    // payments for 121.35 of interest. The declining minimum shrinks with the
    // balance, so it takes 40 payments and 185.67 — and 40 is what the summary
    // must report.
    const config = decliningCard();
    const declining = calculateDecliningMinimumPayoff(config, d(TODAY));
    const flat = calculateCreditCardPayoff(1_000, 12, 50, d(TODAY));
    expect(declining).toHaveLength(40);
    expect(flat).toHaveLength(23);

    const summary = calculatePayoffSummary(config);
    expect(summary.monthsToPayoff).toBe(40);
    expect(summary.totalInterestToPay).toBeCloseTo(185.671004, 6);
  });

  it("routes the fixed strategy to a level schedule at the configured amount", () => {
    const summary = calculatePayoffSummary(fixedCard());
    const schedule = calculateCreditCardPayoff(5_000, 24, 500, d(TODAY));
    expect(schedule).toHaveLength(12);
    expect(summary.monthsToPayoff).toBe(12);
    expect(summary.effectiveMonthlyPayment).toBe(500);
    expect(summary.totalInterestToPay).toBeCloseTo(635.164109, 6);
  });

  it("routes a fixed strategy with no amount to a LEVEL schedule at the minimum payment", () => {
    // Worth pinning because it is the one place the two branches disagree: the
    // payment falls back to the minimum (50), but the schedule holds it level
    // instead of recomputing it, so this card is modelled as 23 payments, not
    // the 40 the same 50 would take under the "minimum" strategy.
    const config = decliningCard({ paymentStrategy: "fixed", fixedPaymentAmount: undefined });
    const summary = calculatePayoffSummary(config);
    expect(summary.effectiveMonthlyPayment).toBe(50);
    expect(summary.monthsToPayoff).toBe(23);
    expect(summary.totalInterestToPay).toBeCloseTo(121.347927, 6);
    expect(calculatePayoffSummary(decliningCard()).monthsToPayoff).toBe(40);
  });

  it("routes the full_balance strategy to a level schedule at the whole balance", () => {
    const summary = calculatePayoffSummary(fixedCard({ paymentStrategy: "full_balance" }));
    expect(summary.effectiveMonthlyPayment).toBe(5_000);
    expect(summary.totalAmountToPay).toBeCloseTo(
      paidOver(calculateCreditCardPayoff(5_000, 24, 5_000, d(TODAY))),
      10
    );
  });

  it("routes an unrecognised strategy to a level schedule at the minimum payment", () => {
    // `paymentStrategy === "minimum"` is a string equality check, so only that
    // exact value gets the declining schedule; getEffectivePayment's `default`
    // branch still returns the minimum. An unknown strategy therefore behaves
    // like fixed-with-no-amount (23 level payments), not like "minimum" (40).
    const config = decliningCard({
      paymentStrategy: "avalanche" as CreditConfig["paymentStrategy"],
    });
    const summary = calculatePayoffSummary(config);
    expect(summary.effectiveMonthlyPayment).toBe(50);
    expect(summary.monthsToPayoff).toBe(23);
  });
});

// ============================================================================
// calculatePayoffSummary — timeline
// ============================================================================

describe("calculatePayoffSummary: payoff timeline", () => {
  it("reports monthsToPayoff as the length of the schedule it chose", () => {
    expect(calculatePayoffSummary(fixedCard()).monthsToPayoff).toBe(
      calculateCreditCardPayoff(5_000, 24, 500, d(TODAY)).length
    );
    expect(calculatePayoffSummary(decliningCard()).monthsToPayoff).toBe(
      calculateDecliningMinimumPayoff(decliningCard(), d(TODAY)).length
    );
  });

  it("dates the payoff on the LAST payment, which is monthsToPayoff - 1 months out", () => {
    // The schedule dates its first payment TODAY, so a 12-payment card is
    // retired 11 months from now, not 12. That off-by-one is inherent to the
    // schedule's own dating and is pinned here so the UI's "Estimated Payoff
    // Date" has a defined meaning.
    const summary = calculatePayoffSummary(fixedCard());
    const schedule = calculateCreditCardPayoff(5_000, 24, 500, d(TODAY));
    expect(summary.monthsToPayoff).toBe(12);
    expect(summary.payoffDate).not.toBeNull();
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(addMonths(TODAY, 11));
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(ymd(schedule[11].date));
  });

  it("dates a 40-month declining-minimum payoff 39 months out", () => {
    const summary = calculatePayoffSummary(decliningCard());
    expect(summary.monthsToPayoff).toBe(40);
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(addMonths(TODAY, 39));
    expect(addMonths(TODAY, 39)).toBe("2029-06-15");
  });

  it("divides monthsToPayoff by 12 for yearsToPayoff with NO rounding at all", () => {
    // Pinned because it is a raw division: `schedule.length / 12`. A 40-month
    // payoff surfaces as 3.3333333333333335, not 3.3 and not 3.
    expect(calculatePayoffSummary(decliningCard()).yearsToPayoff).toBe(40 / 12);
    expect(calculatePayoffSummary(decliningCard()).yearsToPayoff).toBe(3.3333333333333335);
    expect(calculatePayoffSummary(fixedCard()).yearsToPayoff).toBe(1);
    expect(calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 900 })).yearsToPayoff).toBe(0.5);
  });

  it("keeps yearsToPayoff, monthsToPayoff and payoffDate mutually consistent", () => {
    const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 900 }));
    expect(summary.monthsToPayoff).toBe(6);
    expect(summary.yearsToPayoff * 12).toBe(summary.monthsToPayoff);
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(
      addMonths(TODAY, summary.monthsToPayoff - 1)
    );
  });
});

// ============================================================================
// calculatePayoffSummary — totals
// ============================================================================

describe("calculatePayoffSummary: totals", () => {
  it("totals every payment in the schedule into totalAmountToPay", () => {
    const summary = calculatePayoffSummary(decliningCard());
    const schedule = calculateDecliningMinimumPayoff(decliningCard(), d(TODAY));
    expect(schedule).toHaveLength(40);
    expect(summary.totalAmountToPay).toBeCloseTo(paidOver(schedule), 10);
    expect(summary.totalAmountToPay).toBeCloseTo(1_185.671004, 6);
  });

  it("takes totalInterestToPay from the schedule's accumulated interest", () => {
    const summary = calculatePayoffSummary(decliningCard());
    const schedule = calculateDecliningMinimumPayoff(decliningCard(), d(TODAY));
    // Recomputed from the per-period interest, not read off cumulativeInterest.
    expect(summary.totalInterestToPay).toBeCloseTo(interestOver(schedule), 10);
    expect(summary.totalInterestToPay).toBeCloseTo(schedule[39].cumulativeInterest, 10);
  });

  it("keeps the totals in balance: everything paid is principal plus interest", () => {
    const config = fixedCard();
    const summary = calculatePayoffSummary(config);
    expect(summary.totalAmountToPay).toBeCloseTo(
      config.currentBalance + summary.totalInterestToPay,
      8
    );
    expect(summary.totalAmountToPay).toBeCloseTo(5_635.164109, 6);
    expect(summary.totalInterestToPay).toBeCloseTo(635.164109, 6);
  });

  it("totals a level schedule as (n - 1) full payments plus a trimmed final one", () => {
    const summary = calculatePayoffSummary(fixedCard());
    const schedule = calculateCreditCardPayoff(5_000, 24, 500, d(TODAY));
    const finalPayment = schedule[11].payment;
    expect(finalPayment).toBeCloseTo(135.164109, 6);
    expect(summary.totalAmountToPay).toBeCloseTo(11 * 500 + finalPayment, 8);
  });
});

// ============================================================================
// calculatePayoffSummary — current status
// ============================================================================

describe("calculatePayoffSummary: current status", () => {
  it("derives currentMonthlyInterest from the balance and APR", () => {
    expect(calculatePayoffSummary(fixedCard()).currentMonthlyInterest).toBeCloseTo(
      monthlyInterestOf(5_000, 24),
      10
    );
    expect(calculatePayoffSummary(fixedCard()).currentMonthlyInterest).toBe(100);
    expect(calculatePayoffSummary(decliningCard()).currentMonthlyInterest).toBeCloseTo(
      monthlyInterestOf(1_000, 12),
      10
    );
    expect(calculatePayoffSummary(decliningCard()).currentMonthlyInterest).toBe(10);
  });

  it("uses the opening balance for currentMonthlyInterest, not an averaged one", () => {
    // Sanity check that it is a snapshot of today's cost of carrying the debt:
    // the same card at half the balance costs exactly half as much per month.
    const full = calculatePayoffSummary(fixedCard()).currentMonthlyInterest;
    const half = calculatePayoffSummary(
      fixedCard({ currentBalance: 2_500 })
    ).currentMonthlyInterest;
    expect(half).toBeCloseTo(full / 2, 10);
  });

  it("reports zero monthly interest for a zero-APR card", () => {
    expect(
      calculatePayoffSummary(fixedCard({ apr: 0, fixedPaymentAmount: 300, currentBalance: 1_200 }))
        .currentMonthlyInterest
    ).toBe(0);
  });

  it("reports effectiveMonthlyPayment as getEffectivePayment for every strategy", () => {
    const configs = [
      decliningCard(),
      fixedCard(),
      fixedCard({ fixedPaymentAmount: undefined }),
      fixedCard({ paymentStrategy: "full_balance" }),
      trapCard(),
    ];
    configs.forEach((config) => {
      expect(calculatePayoffSummary(config).effectiveMonthlyPayment).toBe(
        getEffectivePayment(config)
      );
    });
    // And the values themselves, so the test cannot pass by both sides being wrong.
    expect(calculatePayoffSummary(decliningCard()).effectiveMonthlyPayment).toBe(50);
    expect(calculatePayoffSummary(fixedCard()).effectiveMonthlyPayment).toBe(500);
    expect(
      calculatePayoffSummary(fixedCard({ fixedPaymentAmount: undefined })).effectiveMonthlyPayment
    ).toBe(100);
    expect(
      calculatePayoffSummary(fixedCard({ paymentStrategy: "full_balance" })).effectiveMonthlyPayment
    ).toBe(5_000);
  });

  it("reports the FIRST minimum payment for a declining schedule, not an average", () => {
    // effectiveMonthlyPayment is a single number, so for the declining minimum
    // it can only be the opening payment: 5% of 1,000. Every later payment is
    // smaller, and the last is 6.68.
    const summary = calculatePayoffSummary(decliningCard());
    const schedule = calculateDecliningMinimumPayoff(decliningCard(), d(TODAY));
    expect(summary.effectiveMonthlyPayment).toBe(50);
    expect(schedule[0].payment).toBe(50);
    expect(schedule[39].payment).toBeLessThan(50);
    expect(summary.totalAmountToPay / summary.monthsToPayoff).toBeLessThan(
      summary.effectiveMonthlyPayment
    );
  });
});

// ============================================================================
// calculatePayoffSummary — the minimum payment trap
// ============================================================================

describe("calculatePayoffSummary: minimum payment trap", () => {
  it("reports a never-ending payoff as null date and Infinity everywhere else", () => {
    const summary = calculatePayoffSummary(trapCard());
    expect(summary.payoffDate).toBeNull();
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.totalAmountToPay).toBe(Infinity);
    expect(summary.totalInterestToPay).toBe(Infinity);
    expect(summary.yearsToPayoff).toBe(Infinity);
    expect(summary.isMinimumPaymentTrap).toBe(true);
  });

  it("flags the trap exactly when the payment is at most 1.1x the monthly interest", () => {
    // The literal condition in summaryCalculator.ts:42 is
    // `effectivePayment <= currentMonthlyInterest * 1.1`. On this card the
    // interest is 100, so the threshold is 110 (strictly, 110.00000000000001 —
    // 100 * 1.1 is not exact in binary floating point, which is why 110 itself
    // still satisfies `<=`).
    expect(100 * 1.1).toBe(110.00000000000001);
    expect(calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 50 })).isMinimumPaymentTrap).toBe(
      true
    );
    expect(
      calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 109 })).isMinimumPaymentTrap
    ).toBe(true);
    expect(
      calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 110 })).isMinimumPaymentTrap
    ).toBe(true);
    expect(
      calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 110.01 })).isMinimumPaymentTrap
    ).toBe(false);
    expect(
      calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 500 })).isMinimumPaymentTrap
    ).toBe(false);
  });

  it("flags the trap for a payment that exactly equals the monthly interest", () => {
    // The boundary case: 100 of payment against 100 of interest. Nothing ever
    // touches principal, so the card is both flagged AND never retired.
    const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 100 }));
    expect(summary.effectiveMonthlyPayment).toBe(summary.currentMonthlyInterest);
    expect(summary.isMinimumPaymentTrap).toBe(true);
    expect(summary.payoffDate).toBeNull();
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.totalInterestToPay).toBe(Infinity);
  });

  it("still flags the trap for a payment that does eventually retire the card", () => {
    // 110/month against 100 of interest DOES pay the card off — in 122 months,
    // for 8,320 of interest on a 5,000 balance. The flag is a warning about how
    // marginal the payment is, not a claim that payoff is impossible, so it is
    // true here alongside a real payoff date.
    const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 110 }));
    expect(summary.isMinimumPaymentTrap).toBe(true);
    expect(summary.monthsToPayoff).toBe(122);
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(addMonths(TODAY, 121));
    expect(summary.totalInterestToPay).toBeCloseTo(8_319.96219, 5);
  });

  it("treats a payment that beats the interest by half a cent as never paying off", () => {
    // 100.005 against 100 of interest makes 0.005/month of progress. The
    // schedule's own `month > 12 && principal < 0.01` guard stops it at 13 rows
    // with the balance essentially untouched, so the summary reports Infinity.
    // Coherent with the trap flag, and not overstated: 5,000 at half a cent a
    // month is 83,000 years.
    const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 100.005 }));
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.payoffDate).toBeNull();
    expect(summary.isMinimumPaymentTrap).toBe(true);
  });

  it("never reports a null payoff date for a card it has not flagged, once a balance is owed", () => {
    // The invariant that makes the UI coherent: "Never" in the payoff-date slot
    // is always accompanied by the warning badge. It holds for every payment
    // level here because any payment above 1.1x the interest retires the card
    // inside the 600-month horizon (110/month already does it in 122).
    [10, 50, 99, 100, 100.005, 110, 110.01, 200, 500, 5_000].forEach((payment) => {
      const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: payment }));
      if (summary.payoffDate === null) {
        expect(summary.isMinimumPaymentTrap).toBe(true);
      }
      expect(summary.isMinimumPaymentTrap || summary.payoffDate !== null).toBe(true);
    });
  });

  it("reports no NaN for a trapped card, only the Infinity sentinels", () => {
    const summary = calculatePayoffSummary(trapCard());
    expect(nanSummaryFields(summary)).toEqual([]);
  });
});

// ============================================================================
// calculatePayoffSummary — edge cases
// ============================================================================

describe("calculatePayoffSummary: full_balance", () => {
  it("retires a zero-APR card in a single payment with no interest", () => {
    const summary = calculatePayoffSummary(
      makeCreditConfig({ currentBalance: 1_200, apr: 0, paymentStrategy: "full_balance" })
    );
    expect(summary.monthsToPayoff).toBe(1);
    expect(summary.totalAmountToPay).toBe(1_200);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(TODAY);
    expect(summary.yearsToPayoff).toBe(1 / 12);
  });

  it("needs a SECOND month for an interest-bearing card, because the interest is charged first", () => {
    // Consequence of a defect that is already encoded, against the code that
    // owns it: tests/unit/creditCards.test.ts, "KNOWN DEFECT: retires the card
    // in a single payment for full_balance". getEffectivePayment returns exactly
    // `currentBalance` (5,000) but calculateCreditCardPayoff charges that
    // month's 100 of interest before applying it, so 100 of balance survives
    // into a second month and attracts another 2. Not re-encoded here: the fix
    // lives in the payment/payoff layer, and this test pins what the summary
    // reports until then, so the numbers below are documented rather than
    // endorsed.
    const summary = calculatePayoffSummary(fixedCard({ paymentStrategy: "full_balance" }));
    expect(summary.effectiveMonthlyPayment).toBe(5_000);
    expect(summary.monthsToPayoff).toBe(2);
    expect(summary.totalAmountToPay).toBe(5_102);
    expect(summary.totalInterestToPay).toBe(102);
    expect(summary.payoffDate && ymd(summary.payoffDate)).toBe(addMonths(TODAY, 1));
  });
});

describe("calculatePayoffSummary: zero APR", () => {
  it("splits a level payment entirely into principal", () => {
    const summary = calculatePayoffSummary(
      fixedCard({ currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 })
    );
    expect(summary.monthsToPayoff).toBe(4);
    expect(summary.totalAmountToPay).toBe(1_200);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.currentMonthlyInterest).toBe(0);
    expect(summary.isMinimumPaymentTrap).toBe(false);
    expect(summary.yearsToPayoff).toBe(4 / 12);
  });

  it("still retires a zero-APR card on the declining minimum, since the floor guarantees progress", () => {
    const summary = calculatePayoffSummary(
      decliningCard({ currentBalance: 1_200, apr: 0, minimumPaymentPercent: 5 })
    );
    expect(summary.monthsToPayoff).toBe(38);
    expect(summary.totalAmountToPay).toBeCloseTo(1_200, 8);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.effectiveMonthlyPayment).toBe(60);
    expect(summary.isMinimumPaymentTrap).toBe(false);
  });

  it("reports no NaN anywhere for a zero-APR card", () => {
    const summary = calculatePayoffSummary(
      fixedCard({ currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 })
    );
    expect(nanSummaryFields(summary)).toEqual([]);
  });
});

describe("calculatePayoffSummary: progress fields", () => {
  /**
   * NOT A DEFECT IN THIS FUNCTION — but the UI feature built on it is dead.
   *
   * `principalPaidSoFar` / `interestPaidSoFar` are pure pass-through parameters
   * defaulting to 0 (summaryCalculator.ts:19-20, 58-59). Nothing in the app ever
   * supplies them: the only call site is ExpenseRuleDetail.tsx:62,
   * `calculatePayoffSummary(rule.creditConfig)`, with no second or third
   * argument. ExpenseRuleDetail.tsx:275-277 then sizes the "Payoff Progress" bar
   * as `principalPaidSoFar > 0 ? ... : 0`, so that bar is hardcoded to 0% width
   * for every card in the app.
   *
   * That is a real user-visible defect, but it cannot honestly be encoded as an
   * `it.fails` against `calculatePayoffSummary`: this function's behaviour is
   * correct for the arguments it is given, and no input could make it wrong. The
   * missing data is upstream — `CreditConfig` (app/lib/types.ts) has no
   * paid-to-date field of any name, and (as tests/unit/creditCards.test.ts
   * documents at length) nothing writes card progress back at all. A fix belongs
   * in the call site plus the config type, and would leave this function
   * untouched. So the contract is pinned here instead, with the gap named.
   */
  it("defaults both progress fields to zero, which is what every caller gets", () => {
    const summary = calculatePayoffSummary(fixedCard());
    expect(summary.principalPaidSoFar).toBe(0);
    expect(summary.interestPaidSoFar).toBe(0);
  });

  it("passes supplied progress figures straight through without validating them", () => {
    const summary = calculatePayoffSummary(fixedCard(), 1_234.56, 78.9);
    expect(summary.principalPaidSoFar).toBe(1_234.56);
    expect(summary.interestPaidSoFar).toBe(78.9);
    // And they influence nothing else: the schedule is unchanged.
    const baseline = calculatePayoffSummary(fixedCard());
    expect(summary.monthsToPayoff).toBe(baseline.monthsToPayoff);
    expect(summary.totalAmountToPay).toBe(baseline.totalAmountToPay);
    expect(summary.totalInterestToPay).toBe(baseline.totalInterestToPay);
  });

  it("does not clamp progress that exceeds the balance", () => {
    // Pinned deliberately: the pass-through is unguarded, so if a caller is ever
    // wired up the UI's `Math.min(100, ...)` is the only thing standing between
    // a bad number and a broken progress bar.
    const summary = calculatePayoffSummary(fixedCard(), 999_999, -5);
    expect(summary.principalPaidSoFar).toBe(999_999);
    expect(summary.interestPaidSoFar).toBe(-5);
  });
});

describe("calculatePayoffSummary: settled card", () => {
  it("produces no scenarios and no NaN for a zero balance", () => {
    const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance: 0 }));
    expect(summary.scenarios).toEqual([]);
    expect(nanSummaryFields(summary)).toEqual([]);
    expect(summary.currentMonthlyInterest).toBe(0);
  });

  /**
   * DEFECT: a card with nothing owed is reported as never paying off.
   *
   * summaryCalculator.ts:38-39 does
   * `const lastPayment = schedule[schedule.length - 1]` and
   * `willPayOff = lastPayment && lastPayment.remainingBalance < 0.01`. For a
   * zero balance both schedule builders return an EMPTY array (their loop
   * condition is `balance > 0.01`), so `lastPayment` is undefined, `willPayOff`
   * is falsy, and every branch below takes its "never" arm: payoffDate null,
   * monthsToPayoff/totalAmountToPay/totalInterestToPay/yearsToPayoff all
   * Infinity.
   *
   * USER-VISIBLE CONSEQUENCE: ExpenseRuleDetail.tsx:293-300 renders "Never" in
   * danger red for the payoff date and `formatPayoffTime(Infinity)` — "Never
   * (payment too low)" — as the time to pay off, on a card the user has just
   * finished clearing. The `payoffDate &&` guard on line 262 also hides the
   * progress block entirely.
   *
   * CORRECT: nothing owed means nothing left to pay, over no further months.
   */
  it.fails("KNOWN DEFECT: reports a settled card as already paid off", () => {
    const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance: 0 }));
    expect(summary.monthsToPayoff).toBe(0);
    expect(summary.totalAmountToPay).toBe(0);
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.yearsToPayoff).toBe(0);
    // "Never" is the one thing a card with a zero balance is not.
    expect(summary.payoffDate).not.toBeNull();
  });

  /**
   * DEFECT: a settled card on the full_balance strategy is flagged as a
   * minimum-payment trap.
   *
   * summaryCalculator.ts:42 is `effectivePayment <= currentMonthlyInterest * 1.1`
   * with no guard on the balance. For a zero balance on full_balance,
   * getEffectivePayment returns the balance (0) and the monthly interest is also
   * 0, so the test reads `0 <= 0` and returns true.
   *
   * USER-VISIBLE CONSEQUENCE: ExpenseRuleDetail.tsx:250-257 puts a red "Warning"
   * badge on the card with the tooltip "Your payment barely covers interest.
   * Consider increasing your payment." — on a card with no balance and no
   * interest to cover.
   *
   * CORRECT: there is no trap when there is no debt.
   */
  it.fails("KNOWN DEFECT: does not flag a settled card as a minimum payment trap", () => {
    const summary = calculatePayoffSummary(
      makeCreditConfig({ currentBalance: 0, paymentStrategy: "full_balance" })
    );
    expect(summary.effectiveMonthlyPayment).toBe(0);
    expect(summary.currentMonthlyInterest).toBe(0);
    expect(summary.isMinimumPaymentTrap).toBe(false);
  });

  it("does not flag a settled card whose minimum payment sits on its floor", () => {
    // The mirror image, and the reason the defect above is specific to
    // full_balance: the minimum strategy returns the 25 floor for a zero
    // balance, and 25 <= 0 is false.
    const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance: 0 }));
    expect(summary.effectiveMonthlyPayment).toBe(25);
    expect(summary.isMinimumPaymentTrap).toBe(false);
  });
});

// ============================================================================
// calculatePayoffScenarios — generation
// ============================================================================

describe("calculatePayoffScenarios: which scenarios are generated", () => {
  it("offers double payment, one year and two years when all three improve on the baseline", () => {
    const summary = calculatePayoffSummary(decliningCard());
    expect(summary.scenarios.map((s) => s.name)).toEqual([
      "Pay Off in 2 Years",
      "Pay Off in 1 Year",
      "Double Payment",
    ]);
  });

  it("doubles the EFFECTIVE payment for the double-payment scenario", () => {
    const config = decliningCard();
    const scenario = byName(calculatePayoffSummary(config).scenarios, "Double Payment");
    expect(scenario?.monthlyPayment).toBe(getEffectivePayment(config) * 2);
    expect(scenario?.monthlyPayment).toBe(100);
    // And for a fixed card it doubles the fixed amount, not the minimum.
    const fixed = fixedCard();
    expect(byName(calculatePayoffSummary(fixed).scenarios, "Double Payment")?.monthlyPayment).toBe(
      1_000
    );
  });

  it("prices the one-year and two-year scenarios with the PMT formula", () => {
    const scenarios = calculatePayoffSummary(decliningCard()).scenarios;
    expect(byName(scenarios, "Pay Off in 1 Year")?.monthlyPayment).toBe(
      calculatePaymentForMonths(1_000, 12, 12)
    );
    expect(byName(scenarios, "Pay Off in 2 Years")?.monthlyPayment).toBe(
      calculatePaymentForMonths(1_000, 12, 24)
    );
    expect(byName(scenarios, "Pay Off in 1 Year")?.monthlyPayment).toBe(88.85);
    expect(byName(scenarios, "Pay Off in 2 Years")?.monthlyPayment).toBe(47.08);
  });

  it("delivers on each scenario's promised horizon", () => {
    const scenarios = calculatePayoffSummary(decliningCard()).scenarios;
    expect(byName(scenarios, "Pay Off in 1 Year")?.monthsToPayoff).toBe(12);
    expect(byName(scenarios, "Pay Off in 2 Years")?.monthsToPayoff).toBe(24);
    expect(byName(scenarios, "Double Payment")?.monthsToPayoff).toBe(11);
  });

  it("reports each scenario's own total interest and total amount", () => {
    const scenarios = calculatePayoffSummary(decliningCard()).scenarios;
    const twelve = calculateCreditCardPayoff(1_000, 12, 88.85, d(TODAY));
    const scenario = byName(scenarios, "Pay Off in 1 Year");
    expect(twelve).toHaveLength(12);
    expect(scenario?.totalInterest).toBeCloseTo(interestOver(twelve), 10);
    expect(scenario?.totalAmount).toBeCloseTo(paidOver(twelve), 10);
    // A scenario's total is its own principal plus its own interest.
    expect(scenario?.totalAmount).toBeCloseTo(1_000 + (scenario?.totalInterest ?? 0), 8);
  });

  it("sorts ascending by monthlyPayment, not in generation order", () => {
    // Generation order is double / 12-month / 24-month, so a sorted result must
    // reorder them: 47.08 (2 years) < 88.85 (1 year) < 100 (double).
    const payments = calculatePayoffSummary(decliningCard()).scenarios.map((s) => s.monthlyPayment);
    expect(payments).toEqual([47.08, 88.85, 100]);
    expect(payments).toEqual([...payments].sort((a, b) => a - b));
  });

  it("sorts a three-scenario list from a percent_plus_interest minimum ascending too", () => {
    // Different card, different ordering of the same three generators: here the
    // double payment (400) lands between the two PMT scenarios.
    const summary = calculatePayoffSummary(
      trapCard({ minimumPaymentMethod: "percent_plus_interest" })
    );
    expect(summary.effectiveMonthlyPayment).toBe(200);
    expect(summary.scenarios.map((s) => s.name)).toEqual([
      "Pay Off in 2 Years",
      "Double Payment",
      "Pay Off in 1 Year",
    ]);
    expect(summary.scenarios.map((s) => s.monthlyPayment)).toEqual([264.36, 400, 472.8]);
  });

  it("omits the two-year scenario when it would cost more per month than doubling", () => {
    // The guard on scenarioCalculator.ts:66 is
    // `twentyFourMonthPayment > 0 && twentyFourMonthPayment < doublePayment`.
    // On the default trap card the minimum is 2% of 5,000 = 100, so doubling
    // gives 200/month while clearing the card in 24 months needs 264.36. The
    // two-year plan is therefore suppressed even though it is the faster option.
    //
    // The Double Payment scenario drops out too, for a different reason: its own
    // guard (scenarioCalculator.ts:30) requires the doubled schedule to actually
    // reach a zero balance, and 200/month does not retire a 5,000 balance at 24%.
    // So a trapped user is offered exactly one way out.
    //
    // Pinned rather than filed: suppressing an option dearer than "double your
    // payment" is defensible. Worth noting that the one-year scenario carries no
    // equivalent guard and is offered at 472.80, nearly five times the minimum.
    expect(calculatePaymentForMonths(5_000, 24, 24)).toBe(264.36);
    const summary = calculatePayoffSummary(trapCard());
    expect(summary.effectiveMonthlyPayment).toBe(100);
    expect(summary.scenarios.map((s) => s.name)).toEqual(["Pay Off in 1 Year"]);
  });

  it("offers nothing at all for a zero-APR card, because there is no interest to save", () => {
    // Every scenario's saving is measured in interest, and a 0% card has none,
    // so all three are generated and all three are filtered out. Sane, if
    // slightly unhelpful: paying a 0% card off faster genuinely saves no money.
    const summary = calculatePayoffSummary(
      fixedCard({ currentBalance: 1_200, apr: 0, fixedPaymentAmount: 300 })
    );
    expect(summary.totalInterestToPay).toBe(0);
    expect(summary.scenarios).toEqual([]);
    expect(nonFiniteScenarioFields(summary.scenarios)).toEqual([]);
  });

  it("offers nothing for a settled card, without dividing by zero", () => {
    const summary = calculatePayoffSummary(makeCreditConfig({ currentBalance: 0, apr: 24 }));
    expect(summary.scenarios).toEqual([]);
  });
});

// ============================================================================
// calculatePayoffScenarios — savings arithmetic
// ============================================================================

describe("calculatePayoffScenarios: savings arithmetic", () => {
  it("computes the double-payment saving end to end", () => {
    /**
     * Worked by hand, on the declining-minimum card (1,000 at 12% APR = 1% a
     * month, minimum 5% of balance, floor 25):
     *
     * BASELINE — declining minimum. Principal is 5% - 1% = 4% of the balance
     * each month, so balance_n = 1000 * 0.96^n and payment_n = 50 * 0.96^(n-1)
     * until it drops under the 25 floor at month 18; the floor then guarantees
     * progress and the card clears on payment 40 for 185.67100360 of interest
     * (pinned independently in creditCards.test.ts).
     *
     * SCENARIO — double the effective payment: 2 * 50 = 100 a month, level.
     *   balance after k payments = 1000 * 1.01^k - 100 * (1.01^k - 1) / 0.01
     *   1.01^10 = 1.10462212541120
     *   balance after 10 = 1104.62212541 - 1046.22125411 = 58.40087130
     *   payment 11 is the trimmed remainder = 58.40087130 * 1.01 = 58.98488001
     *   total paid = 10 * 100 + 58.98488001 = 1058.98488001
     *   total interest = 1058.98488001 - 1000 = 58.98488001
     *
     * SAVINGS
     *   interestSavings   = 185.67100360 - 58.98488001 = 126.68612359
     *   timeSavingsMonths = 40 - 11 = 29
     */
    const summary = calculatePayoffSummary(decliningCard());
    const scenario = byName(summary.scenarios, "Double Payment");

    expect(summary.totalInterestToPay).toBeCloseTo(185.6710036, 7);
    expect(scenario?.monthlyPayment).toBe(100);
    expect(scenario?.monthsToPayoff).toBe(11);
    expect(scenario?.totalInterest).toBeCloseTo(58.98488001, 8);
    expect(scenario?.totalAmount).toBeCloseTo(1_058.98488001, 8);
    expect(scenario?.interestSavings).toBeCloseTo(126.68612359, 8);
    expect(scenario?.timeSavingsMonths).toBe(29);
  });

  it("measures every scenario's savings against the CURRENT strategy's schedule", () => {
    const summary = calculatePayoffSummary(decliningCard());
    expect(summary.monthsToPayoff).toBe(40);
    summary.scenarios.forEach((scenario) => {
      expect(scenario.interestSavings).toBeCloseTo(
        summary.totalInterestToPay - scenario.totalInterest,
        8
      );
      expect(scenario.timeSavingsMonths).toBe(summary.monthsToPayoff - scenario.monthsToPayoff);
    });
    // Spelled out, so the loop above cannot pass vacuously.
    expect(summary.scenarios.map((s) => s.timeSavingsMonths)).toEqual([16, 28, 29]);
    expect(summary.scenarios.map((s) => Math.round(s.interestSavings * 100) / 100)).toEqual([
      55.93, 119.49, 126.69,
    ]);
  });

  it("takes the baseline from the schedule it is PASSED, not from the config", () => {
    // Called directly with a deliberately slower baseline for the same card: a
    // flat 30/month takes 41 months and 222.50 of interest instead of 40 and
    // 185.67, and every saving grows by exactly that difference.
    const config = decliningCard();
    const slow = calculateCreditCardPayoff(1_000, 12, 30, d(TODAY));
    expect(slow).toHaveLength(41);
    expect(interestOver(slow)).toBeCloseTo(222.49525815, 8);

    const against = calculatePayoffScenarios(config, slow);
    const normal = calculatePayoffScenarios(
      config,
      calculateDecliningMinimumPayoff(config, d(TODAY))
    );
    expect(against.map((s) => s.name)).toEqual(normal.map((s) => s.name));
    against.forEach((scenario, i) => {
      expect(scenario.totalInterest).toBeCloseTo(normal[i].totalInterest, 10);
      expect(scenario.interestSavings - normal[i].interestSavings).toBeCloseTo(
        222.49525815 - 185.6710036,
        7
      );
      expect(scenario.timeSavingsMonths - normal[i].timeSavingsMonths).toBe(1);
    });
  });

  it("returns nothing when passed an empty baseline, because the baseline falls back to zero interest", () => {
    // scenarioCalculator.ts:21 is
    // `currentSchedule[currentSchedule.length - 1]?.cumulativeInterest || 0`.
    // With no baseline every saving is negative and the filter removes them all
    // — no crash, no NaN, just no advice.
    const scenarios = calculatePayoffScenarios(decliningCard(), []);
    expect(scenarios).toEqual([]);
  });
});

// ============================================================================
// calculatePayoffScenarios — the filter
// ============================================================================

describe("calculatePayoffScenarios: drops non-improving scenarios", () => {
  it("omits scenarios that would cost MORE interest than the current plan", () => {
    // 5,000 at 24% on 900/month clears in 6 payments for 353.50 of interest, so
    // both fixed-horizon scenarios are worse:
    //   1 year  at 472.80 -> 12 payments, 673.57 interest -> saving -320.07
    //   2 years at 264.36 -> 24 payments, 1344.50 interest -> saving -991.00
    // Only doubling to 1,800 (3 payments, 197.32) actually improves on it.
    const summary = calculatePayoffSummary(fixedCard({ fixedPaymentAmount: 900 }));
    expect(summary.monthsToPayoff).toBe(6);
    expect(summary.totalInterestToPay).toBeCloseTo(353.50322944, 8);

    const twelve = calculateCreditCardPayoff(
      5_000,
      24,
      calculatePaymentForMonths(5_000, 24, 12),
      d(TODAY)
    );
    const twentyFour = calculateCreditCardPayoff(
      5_000,
      24,
      calculatePaymentForMonths(5_000, 24, 24),
      d(TODAY)
    );
    expect(interestOver(twelve)).toBeGreaterThan(summary.totalInterestToPay);
    expect(interestOver(twentyFour)).toBeGreaterThan(summary.totalInterestToPay);

    expect(summary.scenarios.map((s) => s.name)).toEqual(["Double Payment"]);
    expect(summary.scenarios.every((s) => s.interestSavings > 0)).toBe(true);
    expect(summary.scenarios.every((s) => s.timeSavingsMonths > 0)).toBe(true);
  });

  it("omits a scenario that saves exactly nothing, not merely negative ones", () => {
    // The filter is `> 0`, so a break-even scenario is dropped too. A 0% card
    // makes every scenario break even on interest: three are generated and none
    // survives.
    const config = fixedCard({ currentBalance: 1_200, apr: 0, fixedPaymentAmount: 100 });
    const baseline = calculateCreditCardPayoff(1_200, 0, 100, d(TODAY));
    expect(baseline).toHaveLength(12);
    expect(interestOver(baseline)).toBe(0);
    // The 12-month PMT for a 0% card is exactly the current payment, so that
    // scenario is identical to the baseline: zero saving, zero time difference.
    expect(calculatePaymentForMonths(1_200, 0, 12)).toBe(100);
    expect(calculatePayoffScenarios(config, baseline)).toEqual([]);
  });

  it("keeps every surviving scenario strictly better than the current plan", () => {
    [
      decliningCard(),
      fixedCard(),
      fixedCard({ fixedPaymentAmount: 900 }),
      trapCard({ minimumPaymentMethod: "percent_plus_interest" }),
    ].forEach((config) => {
      const summary = calculatePayoffSummary(config);
      summary.scenarios.forEach((scenario) => {
        expect(scenario.interestSavings).toBeGreaterThan(0);
        expect(scenario.totalInterest).toBeLessThan(summary.totalInterestToPay);
      });
    });
  });
});

// ============================================================================
// calculatePayoffScenarios — degenerate cards
// ============================================================================

describe("calculatePayoffScenarios: degenerate cards", () => {
  it("stays sane for a card already paying its full balance", () => {
    // Nothing NaN, nothing infinite — but the single surviving suggestion is to
    // pay 10,000 a month on a 5,000 card to save 2 of interest. It exists only
    // because of the already-encoded full_balance defect (see
    // "needs a SECOND month..." above): the current plan is modelled as 2
    // payments and 102 of interest, so a payment large enough to absorb the
    // first month's interest as well "saves" the 2 charged in month two. Fix
    // that defect and this scenario breaks even and disappears.
    const summary = calculatePayoffSummary(fixedCard({ paymentStrategy: "full_balance" }));
    expect(nonFiniteScenarioFields(summary.scenarios)).toEqual([]);
    expect(summary.scenarios.map((s) => s.name)).toEqual(["Double Payment"]);
    expect(summary.scenarios[0].monthlyPayment).toBe(10_000);
    expect(summary.scenarios[0].monthsToPayoff).toBe(1);
    expect(summary.scenarios[0].interestSavings).toBe(2);
    expect(summary.scenarios[0].timeSavingsMonths).toBe(1);
  });

  it("stays sane when the minimum payment already exceeds the one-year payment", () => {
    // A 3,000 floor on a 5,000 card: the minimum clears it in 2 payments, far
    // faster than the 472.80/month one-year plan. Both fixed-horizon scenarios
    // are correctly dropped and only doubling survives.
    const summary = calculatePayoffSummary(trapCard({ minimumPaymentFloor: 3_000 }));
    expect(summary.effectiveMonthlyPayment).toBe(3_000);
    expect(summary.effectiveMonthlyPayment).toBeGreaterThan(
      calculatePaymentForMonths(5_000, 24, 12)
    );
    expect(summary.monthsToPayoff).toBe(2);
    expect(nonFiniteScenarioFields(summary.scenarios)).toEqual([]);
    expect(summary.scenarios.map((s) => s.name)).toEqual(["Double Payment"]);
    expect(summary.scenarios[0].monthlyPayment).toBe(6_000);
    expect(summary.scenarios[0].monthsToPayoff).toBe(1);
  });

  it("returns no NaN or Infinity in any scenario field for a trapped card", () => {
    const summary = calculatePayoffSummary(trapCard());
    // Non-vacuity: `flatMap` over an empty list is empty, so pin that there IS
    // at least one scenario before asserting all their fields are finite.
    expect(summary.scenarios.length).toBeGreaterThan(0);
    expect(nonFiniteScenarioFields(summary.scenarios)).toEqual([]);
  });

  it("returns no NaN or Infinity in any scenario field for a percent_plus_interest trap card", () => {
    const summary = calculatePayoffSummary(
      trapCard({ minimumPaymentMethod: "percent_plus_interest", apr: 36 })
    );
    expect(summary.scenarios.length).toBeGreaterThan(0);
    expect(nonFiniteScenarioFields(summary.scenarios)).toEqual([]);
  });
});

// ============================================================================
// calculatePayoffScenarios — known defects
// ============================================================================

describe("calculatePayoffScenarios: known defects", () => {
  /**
   * DEFECT: the most useful advice is withheld from exactly the card that needs
   * it, because the savings baseline comes from a truncated schedule.
   *
   * scenarioCalculator.ts:20-21 takes the baseline from the schedule it is
   * handed: `currentMonths = currentSchedule.length` and
   * `currentInterest = currentSchedule[last]?.cumulativeInterest || 0`. For a
   * card that never pays off, that schedule is not the card's real future — the
   * payoff builders abandon the loop at 13 rows (`month > 12 && principal <
   * 0.01`), so the baseline reads "13 months, 1,300 of interest". The summary
   * built from the very same schedule reports `totalInterestToPay: Infinity`,
   * so the two disagree about the same card.
   *
   * The consequence is the filter on line 85. Doubling this card's payment from
   * 100 to 200 retires it in 36 months for 2,000.56 of interest — the single
   * most valuable thing this feature could tell the user. Measured against the
   * bogus 1,300 baseline that is a "saving" of -700.56, so
   * `.filter(s => s.interestSavings > 0)` deletes it. What survives is the
   * 472.80/month one-year plan, which most users in a minimum-payment trap
   * cannot afford.
   *
   * CORRECT: a card that never pays off has no finite interest baseline, so
   * doubling the payment must appear, with a positive saving.
   */
  it.fails("KNOWN DEFECT: still offers to double the payment on a card that never pays off", () => {
    const summary = calculatePayoffSummary(trapCard());
    // Preconditions, true today: this card never pays off.
    expect(summary.monthsToPayoff).toBe(Infinity);
    expect(summary.totalInterestToPay).toBe(Infinity);

    const scenario = byName(summary.scenarios, "Double Payment");
    // Optional access throughout: a future fix that reshapes the list must fail
    // this through an assertion, never a TypeError.
    expect(summary.scenarios.map((s) => s.name)).toContain("Double Payment");
    expect(scenario?.monthlyPayment).toBe(200);
    expect(scenario?.monthsToPayoff).toBe(36);
    expect(scenario?.interestSavings).toBeGreaterThan(0);
  });

  /**
   * DEFECT: the time saving quoted against a never-ending debt is one month.
   *
   * Same root cause, different field. `timeSavingsMonths` is
   * `currentMonths - scenario.monthsToPayoff` (scenarioCalculator.ts:59), and
   * `currentMonths` is the truncated 13, so the one-year plan is advertised as
   * saving 13 - 12 = 1 month — on a card whose payoff date the summary itself
   * reports as "Never". ExpenseRuleDetail.tsx renders this straight into the
   * scenario table, so the user is told that going from 100/month to 472.80 buys
   * them one month.
   *
   * CORRECT: with no finite baseline the saving is unbounded; at the very least
   * it cannot be smaller than the 12 months the scenario itself takes.
   */
  it.fails("KNOWN DEFECT: does not quote a one-month saving against a debt that never ends", () => {
    const summary = calculatePayoffSummary(trapCard());
    expect(summary.monthsToPayoff).toBe(Infinity);

    const scenario = byName(summary.scenarios, "Pay Off in 1 Year");
    expect(scenario).toBeDefined();
    expect(scenario?.monthsToPayoff).toBe(12);
    // 1 today. Infinity is the natural answer; anything honest exceeds 12.
    expect(scenario?.timeSavingsMonths).toBeGreaterThan(12);
  });

  /**
   * DEFECT: the same summary object contradicts itself about the same card.
   *
   * `calculatePayoffSummary` reports `totalInterestToPay: Infinity` and
   * `monthsToPayoff: Infinity` for this card — the minimum payment never
   * retires it. Yet the scenarios it returns alongside those fields quote the
   * saving from escaping that debt as a finite 626.43 of interest and ONE month
   * of time.
   *
   * Cause: `calculatePayoffScenarios` derives its baseline from
   * `currentSchedule[last].cumulativeInterest` (scenarioCalculator.ts:20), and
   * `calculateCreditCardPayoff` truncates a trapped schedule after month 12
   * (payoffCalculator.ts:60-62). So the baseline is a 13-month slice of an
   * unbounded debt, not the debt itself.
   *
   * Consequence: the payoff panel understates the single most valuable action
   * a trapped user can take. "Save 626 and finish 1 month sooner" describes
   * escaping a debt the same screen calls never-ending.
   *
   * CORRECT: a saving measured against a baseline the module itself reports as
   * Infinity must also be unbounded — the scenario fields must agree with
   * `totalInterestToPay`/`monthsToPayoff` for the same card.
   */
  it.fails("KNOWN DEFECT: quotes a finite saving against a baseline it calls Infinity", () => {
    const summary = calculatePayoffSummary(trapCard());

    // The module's own verdict on this card.
    expect(summary.totalInterestToPay).toBe(Infinity);
    expect(summary.monthsToPayoff).toBe(Infinity);

    const scenario = byName(summary.scenarios, "Pay Off in 1 Year");
    expect(scenario).toBeDefined();

    // Escaping an unbounded debt saves an unbounded amount of interest and time.
    expect(scenario?.interestSavings).toBe(Infinity);
    expect(scenario?.timeSavingsMonths).toBe(Infinity);
  });

  it("quotes savings consistent with a finite baseline when the card does pay off", () => {
    // The control case. Note the invariant is only that savings are positive and
    // strictly smaller than the baseline's own interest — NOT that they exceed
    // the alternative's cost. A cheaper plan can still carry more interest than
    // it saves (doubling the payment on decliningCard saves 55.93 while the
    // doubled plan itself costs 129.74), which is ordinary amortization, not a
    // defect. Only the truncated-baseline case above is inconsistent.
    [decliningCard(), fixedCard({ fixedPaymentAmount: 110 })].forEach((config) => {
      const summary = calculatePayoffSummary(config);
      expect(Number.isFinite(summary.totalInterestToPay)).toBe(true);
      expect(summary.scenarios.length).toBeGreaterThan(0);
      summary.scenarios.forEach((scenario) => {
        expect(scenario.interestSavings).toBeGreaterThan(0);
        expect(scenario.interestSavings).toBeLessThan(summary.totalInterestToPay);
        expect(Number.isFinite(scenario.totalInterest)).toBe(true);
      });
    });
  });
});
