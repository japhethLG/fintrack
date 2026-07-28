import { beforeEach, describe, expect, it } from "vitest";

import type { DayBalance, Transaction } from "@/lib/types";
import { getBillCoverageReport } from "@/lib/logic/balanceCalculator/billCoverage";
import { getNextCrunch, getRunway } from "@/lib/logic/balanceCalculator/runway";
import { calculateForecast } from "@/lib/logic/forecasting/forecastCalculator";
import {
  calculateBalanceTrendScore,
  calculateBillPaymentScore,
  calculateRunwayScore,
  calculateSavingsRateScore,
} from "@/lib/logic/healthScore/scoreCalculators";
import { getPeriodStats } from "@/lib/logic/healthScore/periodStats";
import { calculateHealthScore } from "@/lib/logic/healthScore/healthScoreCalculator";
import { getGrade, getScoreColor } from "@/lib/logic/healthScore/insights";
import { getMonthlyMultiplier, prorateToDateRange } from "@/lib/utils/frequencyUtils";
import {
  makeCompletedTransaction,
  makeProjectedTransaction,
  makeSkippedTransaction,
  makeTransaction,
} from "../helpers/builders";
import { d, ymd } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * THEME: the forward-looking derivations — bill coverage, runway, crunch dates,
 * the balance forecast, the health score components and the frequency helpers.
 *
 * Every function here reads "today" from `new Date()` (or, for the forecast, is
 * driven by a caller-supplied start date that in production is `new Date()`), so
 * EVERY test freezes the clock. An unfrozen clock would make these suites pass
 * or fail depending on the day they are run.
 *
 * Two cross-cutting decisions are pinned repeatedly, because the modules
 * DISAGREE with each other and the disagreement is user-visible:
 *   1. WHICH TRANSACTIONS — `getRunway`/`getNextCrunch` walk completed
 *      transactions as well as projected ones, `calculateRunwayScore` and
 *      `calculateForecast` exclude completed entirely.
 *   2. WHICH DATE — most filters use `actualDate || scheduledDate`;
 *      `getBillCoverageReport.daysUntilDue`, `calculateBillPaymentScore` and
 *      `calculateForecast` use `scheduledDate` only.
 */

// ============================================================================
// LOCAL HELPERS
//
// Gaps in the shared helpers, noted for the report:
//   - tests/helpers/dates.ts has no "add N days to a YYYY-MM-DD" helper, and
//     the score bands below are all expressed as "run out on day N", so
//     `plusDays` is defined here (raw Date arithmetic, not the engine's dayjs).
//   - tests/helpers/builders.ts has no DayBalance builder, which
//     calculateBalanceTrendScore consumes, hence `dayBalances`.
//   - makeCompletedTransaction always fills in `actualAmount`, so the
//     `actualAmount ?? projectedAmount` fallback needs `completedWithoutActual`.
// ============================================================================

/** "2026-03-10" + n days, computed with raw Date accessors. */
const plusDays = (base: string, n: number): string => {
  const date = d(base);
  date.setDate(date.getDate() + n);
  return ymd(date);
};

/** A DayBalance map keyed by date, in the insertion order given. */
const dayBalances = (entries: Array<[string, number]>): Map<string, DayBalance> =>
  new Map(
    entries.map(([date, closingBalance]) => [
      date,
      {
        date,
        openingBalance: closingBalance,
        closingBalance,
        totalIncome: 0,
        totalExpenses: 0,
        projectedIncome: 0,
        projectedExpenses: 0,
        transactions: [],
        status: "safe" as const,
      },
    ])
  );

/** A completed transaction with NO `actualAmount` — exercises the fallback. */
const completedWithoutActual = (overrides: Partial<Transaction> = {}): Transaction =>
  makeTransaction({
    status: "completed",
    actualDate: overrides.actualDate ?? overrides.scheduledDate ?? "2026-03-11",
    ...overrides,
  });

/** The frozen "today" for every test in this file. 2026-03-10 is a Tuesday. */
const TODAY = "2026-03-10";

// ============================================================================
// getBillCoverageReport
// ============================================================================

describe("getBillCoverageReport", () => {
  beforeEach(() => freezeToday(TODAY));

  describe("window", () => {
    it("includes both boundary days of [today, today + daysAhead] and nothing outside", () => {
      // daysAhead 14 from 2026-03-10 => window 2026-03-10 .. 2026-03-24.
      const report = getBillCoverageReport(
        100_000,
        [
          makeProjectedTransaction({ id: "before", scheduledDate: "2026-03-09" }),
          makeProjectedTransaction({ id: "first-day", scheduledDate: TODAY }),
          makeProjectedTransaction({ id: "last-day", scheduledDate: "2026-03-24" }),
          makeProjectedTransaction({ id: "after", scheduledDate: "2026-03-25" }),
        ],
        14
      );

      expect(report.upcomingBills.map((b) => b.transaction.id)).toEqual(["first-day", "last-day"]);
    });

    it("honours a custom daysAhead window", () => {
      const report = getBillCoverageReport(
        100_000,
        [
          makeProjectedTransaction({ id: "day-7", scheduledDate: plusDays(TODAY, 7) }),
          makeProjectedTransaction({ id: "day-8", scheduledDate: plusDays(TODAY, 8) }),
        ],
        7
      );

      expect(report.upcomingBills.map((b) => b.transaction.id)).toEqual(["day-7"]);
    });

    it("excludes completed and skipped transactions — only unrealized bills need covering", () => {
      const report = getBillCoverageReport(1_000, [
        makeCompletedTransaction({ id: "paid", scheduledDate: "2026-03-12", projectedAmount: 400 }),
        makeSkippedTransaction({
          id: "skipped",
          scheduledDate: "2026-03-13",
          projectedAmount: 400,
        }),
        makeProjectedTransaction({ id: "due", scheduledDate: "2026-03-14", projectedAmount: 400 }),
      ]);

      expect(report.upcomingBills.map((b) => b.transaction.id)).toEqual(["due"]);
      expect(report.totalUpcoming).toBe(400);
      expect(report.projectedBalance).toBe(600);
    });

    it("reports no bills for an empty transaction list", () => {
      expect(getBillCoverageReport(500, [])).toEqual({
        currentBalance: 500,
        upcomingBills: [],
        totalUpcoming: 0,
        projectedBalance: 500,
        canCoverAll: true,
        firstShortfall: undefined,
      });
    });
  });

  describe("running balance", () => {
    it("flips a bill from uncoverable to coverable once payday precedes it", () => {
      // Same 800 bill, twice: once before the 3,000 payday and once after it.
      // Balance 500 -> bill on the 12th overdraws by 300; the payday lifts the
      // running balance to 2,700 so the identical bill on the 18th is covered.
      const report = getBillCoverageReport(500, [
        makeProjectedTransaction({
          id: "before-payday",
          name: "Rent",
          scheduledDate: "2026-03-12",
          projectedAmount: 800,
        }),
        makeProjectedTransaction({
          id: "payday",
          name: "Salary",
          type: "income",
          scheduledDate: "2026-03-15",
          projectedAmount: 3_000,
        }),
        makeProjectedTransaction({
          id: "after-payday",
          name: "Insurance",
          scheduledDate: "2026-03-18",
          projectedAmount: 800,
        }),
      ]);

      expect(report.upcomingBills.map((b) => [b.transaction.id, b.canCover])).toEqual([
        ["before-payday", false],
        ["after-payday", true],
      ]);
      expect(report.upcomingBills[0].shortfall).toBe(300);
      expect(report.upcomingBills[1].shortfall).toBeUndefined();
    });

    it("evaluates bills chronologically, not in input order", () => {
      // Input order is reversed on purpose: the 900 bill on the 20th must be
      // evaluated after the 900 bill on the 12th, so only the later one fails.
      const report = getBillCoverageReport(1_000, [
        makeProjectedTransaction({
          id: "later",
          scheduledDate: "2026-03-20",
          projectedAmount: 900,
        }),
        makeProjectedTransaction({
          id: "earlier",
          scheduledDate: "2026-03-12",
          projectedAmount: 900,
        }),
      ]);

      expect(report.upcomingBills.map((b) => [b.transaction.id, b.canCover])).toEqual([
        ["earlier", true],
        ["later", false],
      ]);
    });

    it("projects the balance after every bill AND every income in the window", () => {
      // 1,000 - 200 + 3,000 - 300 = 3,500
      const report = getBillCoverageReport(1_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 200 }),
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-13",
          projectedAmount: 3_000,
        }),
        makeProjectedTransaction({
          id: "bill2",
          scheduledDate: "2026-03-15",
          projectedAmount: 300,
        }),
      ]);

      expect(report.projectedBalance).toBe(3_500);
    });

    it("sums only expenses into totalUpcoming, never income", () => {
      const report = getBillCoverageReport(10_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 200 }),
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-13",
          projectedAmount: 3_000,
        }),
        makeProjectedTransaction({
          id: "bill2",
          scheduledDate: "2026-03-15",
          projectedAmount: 300,
        }),
      ]);

      expect(report.totalUpcoming).toBe(500);
    });
  });

  describe("coverage verdict", () => {
    it("counts a bill that lands the balance on exactly zero as covered", () => {
      const report = getBillCoverageReport(1_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-15", projectedAmount: 1_000 }),
      ]);

      expect(report.upcomingBills[0].canCover).toBe(true);
      expect(report.upcomingBills[0].shortfall).toBeUndefined();
      expect(report.projectedBalance).toBe(0);
      expect(report.canCoverAll).toBe(true);
    });

    it("reports the absolute overdraft as the shortfall when a bill is not covered", () => {
      const report = getBillCoverageReport(1_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-15", projectedAmount: 1_500 }),
      ]);

      expect(report.upcomingBills[0].canCover).toBe(false);
      expect(report.upcomingBills[0].shortfall).toBe(500);
    });

    it("attributes canCoverAll and firstShortfall to the FIRST uncoverable bill", () => {
      // Balance 100: "Water" overdraws to -100 (shortfall 100), then
      // "Electric" compounds it to -400 (shortfall 400).
      const report = getBillCoverageReport(100, [
        makeProjectedTransaction({
          id: "water",
          name: "Water",
          scheduledDate: "2026-03-12",
          projectedAmount: 200,
        }),
        makeProjectedTransaction({
          id: "electric",
          name: "Electric",
          scheduledDate: "2026-03-14",
          projectedAmount: 300,
        }),
      ]);

      expect(report.canCoverAll).toBe(false);
      expect(report.upcomingBills.map((b) => b.shortfall)).toEqual([100, 400]);
      expect(report.firstShortfall).toEqual({
        date: "2026-03-12",
        amount: 100,
        billName: "Water",
      });
      expect(report.projectedBalance).toBe(-400);
    });
  });

  describe("daysUntilDue", () => {
    it("counts whole days from today to the scheduled date, 0 for a bill due today", () => {
      const report = getBillCoverageReport(100_000, [
        makeProjectedTransaction({ id: "today", scheduledDate: TODAY }),
        makeProjectedTransaction({ id: "week", scheduledDate: plusDays(TODAY, 7) }),
        makeProjectedTransaction({ id: "edge", scheduledDate: plusDays(TODAY, 14) }),
      ]);

      expect(report.upcomingBills.map((b) => b.daysUntilDue)).toEqual([0, 7, 14]);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: the window filter and the sort use `actualDate || scheduledDate`
     * (app/lib/logic/balanceCalculator/billCoverage.ts:28 and :36-38) but
     * `daysUntilDue` — and `firstShortfall.date` — are derived from
     * `scheduledDate` alone (billCoverage.ts:59-60, :82).
     *
     * So a still-unrealized bill whose `actualDate` falls inside the window
     * while its `scheduledDate` falls outside is pulled into the report and
     * then described with a due date that contradicts the window: here it is
     * reported as an "upcoming bill in the next 14 days" with
     * daysUntilDue = 52.
     *
     * CORRECT: whatever date decides membership must also drive daysUntilDue,
     * so every bill in a `daysAhead`-day report has 0 <= daysUntilDue <=
     * daysAhead. The assertion below is written to pass under either fix
     * (filter on scheduledDate, or compute daysUntilDue from the effective
     * date) and to fail on today's code.
     */
    it.fails("KNOWN DEFECT: keeps daysUntilDue inside the reported window", () => {
      const report = getBillCoverageReport(
        10_000,
        [
          makeProjectedTransaction({
            id: "rescheduled",
            scheduledDate: "2026-05-01",
            actualDate: "2026-03-12",
            projectedAmount: 100,
          }),
        ],
        14
      );

      expect(report.upcomingBills.every((b) => b.daysUntilDue >= 0 && b.daysUntilDue <= 14)).toBe(
        true
      );
    });
  });
});

// ============================================================================
// getRunway
// ============================================================================

describe("getRunway", () => {
  beforeEach(() => freezeToday(TODAY));

  it("returns the day index and date on which the balance first goes negative", () => {
    // 1,000 - 400 (11th) - 400 (12th) - 400 (13th) => -200 on the 13th, day 3.
    const result = getRunway(1_000, [
      makeProjectedTransaction({ id: "a", scheduledDate: "2026-03-11", projectedAmount: 400 }),
      makeProjectedTransaction({ id: "b", scheduledDate: "2026-03-12", projectedAmount: 400 }),
      makeProjectedTransaction({ id: "c", scheduledDate: "2026-03-13", projectedAmount: 400 }),
    ]);

    expect(result).toEqual({ days: 3, runOutDate: "2026-03-13" });
  });

  it("returns maxDays and a null runOutDate when the balance never goes negative", () => {
    expect(getRunway(1_000, [], 30)).toEqual({ days: 30, runOutDate: null });
  });

  it("stops looking after maxDays even though a later run-out exists", () => {
    const result = getRunway(
      1_000,
      [
        makeProjectedTransaction({
          scheduledDate: plusDays(TODAY, 40),
          projectedAmount: 5_000,
        }),
      ],
      30
    );

    expect(result).toEqual({ days: 30, runOutDate: null });
  });

  it("treats a balance of exactly zero as still solvent", () => {
    // The guard is `balance < 0`, so spending the balance down to 0 is not a
    // run-out.
    expect(
      getRunway(
        1_000,
        [makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 1_000 })],
        30
      )
    ).toEqual({ days: 30, runOutDate: null });
  });

  it("reports day 0 and today's date when today's bills already overdraw", () => {
    expect(
      getRunway(100, [makeProjectedTransaction({ scheduledDate: TODAY, projectedAmount: 500 })])
    ).toEqual({ days: 0, runOutDate: TODAY });
  });

  it("ignores skipped transactions", () => {
    expect(
      getRunway(
        1_000,
        [makeSkippedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 99_999 })],
        30
      )
    ).toEqual({ days: 30, runOutDate: null });
  });

  it("uses actualAmount for completed transactions and projectedAmount for projected ones", () => {
    // The completed bill's projectedAmount (5,000) would overdraw on the 11th;
    // its actualAmount (200) does not, so the run-out is driven by the
    // projected 900 on the 12th: 1,000 - 200 - 900 = -100.
    const result = getRunway(1_000, [
      makeCompletedTransaction({
        id: "settled",
        scheduledDate: "2026-03-11",
        projectedAmount: 5_000,
        actualAmount: 200,
      }),
      makeProjectedTransaction({
        id: "upcoming",
        scheduledDate: "2026-03-12",
        projectedAmount: 900,
      }),
    ]);

    expect(result).toEqual({ days: 2, runOutDate: "2026-03-12" });
  });

  it("falls back to projectedAmount for a completed transaction with no actualAmount", () => {
    const result = getRunway(1_000, [
      completedWithoutActual({ scheduledDate: "2026-03-11", projectedAmount: 1_200 }),
    ]);

    expect(result).toEqual({ days: 1, runOutDate: "2026-03-11" });
  });

  it("buckets a completed transaction on its actualDate, not its scheduledDate", () => {
    const result = getRunway(1_000, [
      makeCompletedTransaction({
        scheduledDate: "2026-03-11",
        actualDate: "2026-03-15",
        projectedAmount: 1_200,
        actualAmount: 1_200,
      }),
    ]);

    expect(result).toEqual({ days: 5, runOutDate: "2026-03-15" });
  });

  it("counts income on the same day before deciding the balance went negative", () => {
    // 100 - 500 + 1,000 on the 11th nets to +600, so there is no run-out.
    expect(
      getRunway(
        100,
        [
          makeProjectedTransaction({
            id: "bill",
            scheduledDate: "2026-03-11",
            projectedAmount: 500,
          }),
          makeProjectedTransaction({
            id: "pay",
            type: "income",
            scheduledDate: "2026-03-11",
            projectedAmount: 1_000,
          }),
        ],
        30
      )
    ).toEqual({ days: 30, runOutDate: null });
  });

  it("contrasts with calculateRunwayScore, which excludes completed transactions", () => {
    // Identical input, opposite treatment of the completed bill: getRunway
    // spends it again, calculateRunwayScore ignores it.
    const completed = makeCompletedTransaction({
      scheduledDate: "2026-03-11",
      projectedAmount: 1_200,
      actualAmount: 1_200,
    });

    expect(getRunway(1_000, [completed], 30)).toEqual({ days: 1, runOutDate: "2026-03-11" });
    expect(calculateRunwayScore(1_000, [completed]).daysRemaining).toBe(90);
  });

  describe("known defects", () => {
    /**
     * DEFECT: `getRunway` walks every non-skipped transaction, including
     * completed ones (app/lib/logic/balanceCalculator/runway.ts:32-35), and
     * subtracts them from `currentBalance` — but `currentBalance` is the
     * account balance TODAY and therefore already reflects money that has
     * actually moved. A completed transaction dated in the future is spent
     * twice: once inside the real balance, once again by the projection.
     *
     * CORRECT: completed transactions must not move the projected balance, the
     * way calculateRunwayScore does it
     * (app/lib/logic/healthScore/scoreCalculators.ts:34-37). With a 1,000
     * balance that already includes the 1,200 payment, there is no run-out.
     */
    it.fails("KNOWN DEFECT: does not re-spend a completed transaction dated in the future", () => {
      const result = getRunway(
        1_000,
        [
          makeCompletedTransaction({
            scheduledDate: "2026-03-11",
            projectedAmount: 1_200,
            actualAmount: 1_200,
          }),
        ],
        30
      );

      expect(result).toEqual({ days: 30, runOutDate: null });
    });
  });
});

// ============================================================================
// getNextCrunch
// ============================================================================

describe("getNextCrunch", () => {
  beforeEach(() => freezeToday(TODAY));

  it("returns the first day whose expenses push the balance negative, with the shortfall", () => {
    // 1,000 - 600 (11th) = 400; 400 - 600 (12th) = -200.
    expect(
      getNextCrunch(1_000, [
        makeProjectedTransaction({ id: "a", scheduledDate: "2026-03-11", projectedAmount: 600 }),
        makeProjectedTransaction({ id: "b", scheduledDate: "2026-03-12", projectedAmount: 600 }),
      ])
    ).toEqual({ date: "2026-03-12", shortfall: 200 });
  });

  it("returns null when the balance never goes negative", () => {
    expect(
      getNextCrunch(1_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 600 }),
      ])
    ).toBeNull();
  });

  it("returns null when the crunch falls beyond maxDays", () => {
    expect(
      getNextCrunch(
        100,
        [makeProjectedTransaction({ scheduledDate: plusDays(TODAY, 40), projectedAmount: 500 })],
        30
      )
    ).toBeNull();
  });

  it("nets same-day income against same-day expenses before testing the balance", () => {
    expect(
      getNextCrunch(100, [
        makeProjectedTransaction({ id: "bill", scheduledDate: "2026-03-11", projectedAmount: 500 }),
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-11",
          projectedAmount: 1_000,
        }),
      ])
    ).toBeNull();
  });

  it("ignores skipped transactions", () => {
    expect(
      getNextCrunch(100, [
        makeSkippedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 5_000 }),
      ])
    ).toBeNull();
  });

  it("uses actualAmount for completed transactions", () => {
    // actualAmount 5,000 overdraws where projectedAmount 10 would not.
    expect(
      getNextCrunch(1_000, [
        makeCompletedTransaction({
          scheduledDate: "2026-03-11",
          projectedAmount: 10,
          actualAmount: 5_000,
        }),
      ])
    ).toEqual({ date: "2026-03-11", shortfall: 4_000 });
  });

  describe("the dayExpenses > 0 guard", () => {
    /**
     * JUDGEMENT: the guard (runway.ts:103) means a day is only ever reported
     * when an expense lands on it. Because the balance can only fall on days
     * that have expenses, the only way to be negative on a quiet day is to
     * have started negative — i.e. `currentBalance` is already overdrawn. In
     * that situation the function reports nothing at all, which contradicts
     * its own docstring ("Find the next date when balance will go negative").
     * That is a reporting gap rather than a miscalculation: the account is
     * already overdrawn, so nothing "goes" negative, and the widgets that
     * consume this have a separate negative-balance signal. Pinned as
     * behaviour, not filed as a defect.
     */
    it("skips a negative day that carries an earlier deficit but has no expenses of its own", () => {
      // Already overdrawn at -500. The 11th only receives income (-400, still
      // negative, no expenses => skipped). The crunch is not reported until the
      // 12th, where a 50 expense lands, and the shortfall is the cumulative 450.
      expect(
        getNextCrunch(-500, [
          makeProjectedTransaction({
            id: "pay",
            type: "income",
            scheduledDate: "2026-03-11",
            projectedAmount: 100,
          }),
          makeProjectedTransaction({
            id: "bill",
            scheduledDate: "2026-03-12",
            projectedAmount: 50,
          }),
        ])
      ).toEqual({ date: "2026-03-12", shortfall: 450 });
    });

    it("reports no crunch at all for an already-overdrawn account with no upcoming expenses", () => {
      expect(getNextCrunch(-500, [])).toBeNull();
    });
  });
});

// ============================================================================
// calculateForecast
// ============================================================================

describe("calculateForecast", () => {
  beforeEach(() => freezeToday(TODAY));

  /**
   * NOTE: the forecast keys its days with `toISOString().split("T")[0]` — a UTC
   * calendar day (forecastCalculator.ts:26 and :43) — while the transactions it
   * matches carry local "YYYY-MM-DD" strings. Under this suite's pinned TZ=UTC
   * the two agree exactly, so the assertions below are about the arithmetic;
   * the offset behaviour belongs to the timezone suite.
   */

  it("returns exactly daysToForecast consecutive points starting at startDate", () => {
    const forecast = calculateForecast(1_000, [], d(TODAY), 5);

    expect(forecast.map((p) => p.date)).toEqual([
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
      "2026-03-14",
    ]);
  });

  it("defaults to a 90-day horizon", () => {
    const forecast = calculateForecast(1_000, [], d(TODAY));

    expect(forecast).toHaveLength(90);
    expect(forecast[0].date).toBe("2026-03-10");
    // 2026-03-10 + 89 days: 21 days to 03-31, 30 to 04-30, 31 to 05-31, 7 more.
    expect(forecast[89].date).toBe("2026-06-07");
  });

  it("keeps the balance flat on days with no transactions", () => {
    expect(calculateForecast(1_000, [], d(TODAY), 3).map((p) => p.balance)).toEqual([
      1_000, 1_000, 1_000,
    ]);
  });

  it("adds income and subtracts expenses on the day they are scheduled", () => {
    const forecast = calculateForecast(
      1_000,
      [
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-11",
          projectedAmount: 500,
        }),
        makeProjectedTransaction({ id: "bill", scheduledDate: "2026-03-13", projectedAmount: 200 }),
      ],
      d(TODAY),
      5
    );

    expect(forecast.map((p) => p.balance)).toEqual([1_000, 1_500, 1_500, 1_300, 1_300]);
  });

  it("includes startDate's own transactions in the very first point", () => {
    const forecast = calculateForecast(
      1_000,
      [makeProjectedTransaction({ scheduledDate: TODAY, projectedAmount: 100 })],
      d(TODAY),
      3
    );

    expect(forecast[0]).toEqual({ date: TODAY, balance: 900 });
    expect(forecast.map((p) => p.balance)).toEqual([900, 900, 900]);
  });

  it("ignores transactions scheduled before startDate", () => {
    const forecast = calculateForecast(
      1_000,
      [makeProjectedTransaction({ scheduledDate: "2026-03-09", projectedAmount: 400 })],
      d(TODAY),
      3
    );

    expect(forecast.map((p) => p.balance)).toEqual([1_000, 1_000, 1_000]);
  });

  it("ignores completed and skipped transactions entirely", () => {
    // Opposite of getRunway/getNextCrunch, which spend completed transactions
    // again (see the getRunway known defect). calculateForecast filters on
    // `status === "projected"` (forecastCalculator.ts:27-29), so the same input
    // that runs the runway dry leaves the forecast perfectly flat.
    const transactions = [
      makeCompletedTransaction({
        id: "paid",
        scheduledDate: "2026-03-11",
        projectedAmount: 1_200,
        actualAmount: 1_200,
      }),
      makeSkippedTransaction({ id: "skipped", scheduledDate: "2026-03-12", projectedAmount: 500 }),
    ];

    expect(calculateForecast(1_000, transactions, d(TODAY), 4).map((p) => p.balance)).toEqual([
      1_000, 1_000, 1_000, 1_000,
    ]);
    expect(getRunway(1_000, transactions, 10)).toEqual({ days: 1, runOutDate: "2026-03-11" });
  });

  it("buckets projected transactions by scheduledDate, ignoring any actualDate", () => {
    const forecast = calculateForecast(
      1_000,
      [
        makeProjectedTransaction({
          scheduledDate: "2026-03-12",
          actualDate: "2026-03-11",
          projectedAmount: 300,
        }),
      ],
      d(TODAY),
      4
    );

    expect(forecast.map((p) => p.balance)).toEqual([1_000, 1_000, 700, 700]);
  });

  it("lets the forecast go negative rather than clamping at zero", () => {
    const forecast = calculateForecast(
      100,
      [makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 400 })],
      d(TODAY),
      3
    );

    expect(forecast.map((p) => p.balance)).toEqual([100, -300, -300]);
  });
});

// ============================================================================
// calculateRunwayScore
// ============================================================================

describe("calculateRunwayScore", () => {
  beforeEach(() => freezeToday(TODAY));

  /** Balance 1,000 wiped out by a single projected 5,000 bill `offset` days out. */
  const scoreForRunOutOn = (offset: number) =>
    calculateRunwayScore(1_000, [
      makeProjectedTransaction({
        id: `run-out-${offset}`,
        scheduledDate: plusDays(TODAY, offset),
        projectedAmount: 5_000,
      }),
    ]);

  describe("score bands", () => {
    it("scores 100 when the balance survives the whole 90-day horizon", () => {
      expect(calculateRunwayScore(1_000, [])).toEqual({ score: 100, daysRemaining: 90 });
    });

    it("scores 80 for a run-out between 60 and 89 days out", () => {
      expect(scoreForRunOutOn(89)).toEqual({ score: 80, daysRemaining: 89 });
      expect(scoreForRunOutOn(60)).toEqual({ score: 80, daysRemaining: 60 });
    });

    it("scores 60 for a run-out between 30 and 59 days out", () => {
      expect(scoreForRunOutOn(59)).toEqual({ score: 60, daysRemaining: 59 });
      expect(scoreForRunOutOn(30)).toEqual({ score: 60, daysRemaining: 30 });
    });

    it("scores 40 for a run-out between 14 and 29 days out", () => {
      expect(scoreForRunOutOn(29)).toEqual({ score: 40, daysRemaining: 29 });
      expect(scoreForRunOutOn(14)).toEqual({ score: 40, daysRemaining: 14 });
    });

    it("scores 20 for a run-out between 7 and 13 days out", () => {
      expect(scoreForRunOutOn(13)).toEqual({ score: 20, daysRemaining: 13 });
      expect(scoreForRunOutOn(7)).toEqual({ score: 20, daysRemaining: 7 });
    });

    it("scores 0 for a run-out inside a week, including today", () => {
      expect(scoreForRunOutOn(6)).toEqual({ score: 0, daysRemaining: 6 });
      expect(scoreForRunOutOn(0)).toEqual({ score: 0, daysRemaining: 0 });
    });
  });

  describe("horizon and transaction selection", () => {
    it("caps daysRemaining at 90 even when the run-out is further out", () => {
      expect(scoreForRunOutOn(120)).toEqual({ score: 100, daysRemaining: 90 });
    });

    it("excludes completed and skipped transactions", () => {
      const result = calculateRunwayScore(1_000, [
        makeCompletedTransaction({
          id: "paid",
          scheduledDate: "2026-03-11",
          projectedAmount: 9_999,
          actualAmount: 9_999,
        }),
        makeSkippedTransaction({
          id: "skipped",
          scheduledDate: "2026-03-12",
          projectedAmount: 9_999,
        }),
      ]);

      expect(result).toEqual({ score: 100, daysRemaining: 90 });
    });

    it("always uses projectedAmount, never actualAmount", () => {
      // A projected transaction that somehow carries an actualAmount must still
      // be applied at its projected value (scoreCalculators.ts:40).
      const result = calculateRunwayScore(1_000, [
        makeProjectedTransaction({
          scheduledDate: plusDays(TODAY, 20),
          projectedAmount: 5_000,
          actualAmount: 1,
        }),
      ]);

      expect(result).toEqual({ score: 40, daysRemaining: 20 });
    });

    it("treats a balance of exactly zero as still solvent", () => {
      const result = calculateRunwayScore(1_000, [
        makeProjectedTransaction({ scheduledDate: "2026-03-11", projectedAmount: 1_000 }),
      ]);

      expect(result).toEqual({ score: 100, daysRemaining: 90 });
    });

    it("credits income before testing the balance", () => {
      const result = calculateRunwayScore(1_000, [
        makeProjectedTransaction({
          id: "bill",
          scheduledDate: "2026-03-20",
          projectedAmount: 4_000,
        }),
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-15",
          projectedAmount: 5_000,
        }),
      ]);

      expect(result).toEqual({ score: 100, daysRemaining: 90 });
    });

    it("buckets by actualDate when one is present on an unrealized transaction", () => {
      const result = calculateRunwayScore(1_000, [
        makeProjectedTransaction({
          scheduledDate: plusDays(TODAY, 40),
          actualDate: plusDays(TODAY, 20),
          projectedAmount: 5_000,
        }),
      ]);

      expect(result).toEqual({ score: 40, daysRemaining: 20 });
    });
  });
});

// ============================================================================
// calculateSavingsRateScore
// ============================================================================

describe("calculateSavingsRateScore", () => {
  beforeEach(() => freezeToday(TODAY));

  const PERIOD = { start: "2026-03-01", end: "2026-03-31" };

  /** 1,000 of income against `expenses` of spend, all inside the period. */
  const scoreFor = (expenses: number) =>
    calculateSavingsRateScore(
      [
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-05",
          projectedAmount: 1_000,
        }),
        makeProjectedTransaction({
          id: "spend",
          scheduledDate: "2026-03-06",
          projectedAmount: expenses,
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

  describe("score bands", () => {
    it("scores 100 at and above a 30% savings rate", () => {
      expect(scoreFor(700)).toEqual({ score: 100, rate: 30 });
      expect(scoreFor(500)).toEqual({ score: 100, rate: 50 });
    });

    it("scores 80 from 20% up to just under 30%", () => {
      expect(scoreFor(800)).toEqual({ score: 80, rate: 20 });
      expect(scoreFor(701)).toEqual({ score: 80, rate: 29.9 });
    });

    it("scores 60 from 10% up to just under 20%", () => {
      expect(scoreFor(900)).toEqual({ score: 60, rate: 10 });
      expect(scoreFor(801).score).toBe(60);
    });

    it("scores 40 from 5% up to just under 10%", () => {
      expect(scoreFor(950)).toEqual({ score: 40, rate: 5 });
      expect(scoreFor(901)).toEqual({ score: 40, rate: 9.9 });
    });

    it("scores 20 from break-even up to just under 5%", () => {
      expect(scoreFor(1_000)).toEqual({ score: 20, rate: 0 });
      expect(scoreFor(951)).toEqual({ score: 20, rate: 4.9 });
    });

    it("scores 0 as soon as the rate is negative", () => {
      const result = scoreFor(1_001);
      expect(result.score).toBe(0);
      expect(result.rate).toBeCloseTo(-0.1, 6);
    });
  });

  describe("selection", () => {
    it("returns a neutral 100 with a 0 rate when there are no transactions at all", () => {
      expect(calculateSavingsRateScore([], PERIOD.start, PERIOD.end)).toEqual({
        score: 100,
        rate: 0,
      });
    });

    it("ignores transactions outside the period, keeping both boundary days", () => {
      const result = calculateSavingsRateScore(
        [
          makeProjectedTransaction({
            id: "in-first",
            type: "income",
            scheduledDate: "2026-03-01",
            projectedAmount: 1_000,
          }),
          makeProjectedTransaction({
            id: "in-last",
            scheduledDate: "2026-03-31",
            projectedAmount: 700,
          }),
          makeProjectedTransaction({
            id: "before",
            type: "income",
            scheduledDate: "2026-02-28",
            projectedAmount: 9_999,
          }),
          makeProjectedTransaction({
            id: "after",
            scheduledDate: "2026-04-01",
            projectedAmount: 9_999,
          }),
        ],
        PERIOD.start,
        PERIOD.end
      );

      expect(result).toEqual({ score: 100, rate: 30 });
    });

    it("buckets by actualDate when present, so a late payment can fall out of the period", () => {
      const result = calculateSavingsRateScore(
        [
          makeProjectedTransaction({
            id: "pay",
            type: "income",
            scheduledDate: "2026-03-05",
            projectedAmount: 1_000,
          }),
          makeCompletedTransaction({
            id: "settled-next-month",
            scheduledDate: "2026-03-31",
            actualDate: "2026-04-02",
            projectedAmount: 900,
            actualAmount: 900,
          }),
        ],
        PERIOD.start,
        PERIOD.end
      );

      // The 900 expense is dated out of the period by its actualDate, so the
      // rate is 100% of the 1,000 income.
      expect(result).toEqual({ score: 100, rate: 100 });
    });

    it("ignores skipped transactions", () => {
      const result = calculateSavingsRateScore(
        [
          makeProjectedTransaction({
            id: "pay",
            type: "income",
            scheduledDate: "2026-03-05",
            projectedAmount: 1_000,
          }),
          makeSkippedTransaction({
            id: "skipped",
            scheduledDate: "2026-03-06",
            projectedAmount: 900,
          }),
        ],
        PERIOD.start,
        PERIOD.end
      );

      expect(result).toEqual({ score: 100, rate: 100 });
    });

    it("uses actualAmount for completed transactions", () => {
      const result = calculateSavingsRateScore(
        [
          makeCompletedTransaction({
            id: "pay",
            type: "income",
            scheduledDate: "2026-03-05",
            projectedAmount: 1_000,
            actualAmount: 2_000,
          }),
          makeCompletedTransaction({
            id: "spend",
            scheduledDate: "2026-03-06",
            projectedAmount: 100,
            actualAmount: 1_000,
          }),
        ],
        PERIOD.start,
        PERIOD.end
      );

      // (2,000 - 1,000) / 2,000 = 50%
      expect(result).toEqual({ score: 100, rate: 50 });
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: with zero income and non-zero spending, `rate` is hard-coded to 0
     * (app/lib/logic/healthScore/scoreCalculators.ts:106) because the division
     * would be undefined, and 0 then lands in the `rate >= 0` band and scores
     * 20 (scoreCalculators.ts:113) — the same score as a household that exactly
     * broke even. A month of pure outflow with no income whatsoever is the
     * worst possible savings picture, strictly worse than the "spending more
     * than you earn" case that scores 0.
     *
     * It also mis-drives the insights: `generateInsights` only special-cases
     * rate 0 when the score is 100 (insights.ts:38), so this case is described
     * as "try to increase your savings rate to at least 10%".
     *
     * CORRECT: spending with no income should score 0, like any other negative
     * savings rate.
     */
    it.fails("KNOWN DEFECT: scores 0 for spending in a month with no income", () => {
      const result = calculateSavingsRateScore(
        [makeProjectedTransaction({ scheduledDate: "2026-03-06", projectedAmount: 1_000 })],
        PERIOD.start,
        PERIOD.end
      );

      expect(result.score).toBe(0);
    });
  });
});

// ============================================================================
// calculateBillPaymentScore
// ============================================================================

describe("calculateBillPaymentScore", () => {
  const PERIOD = { start: "2026-03-01", end: "2026-03-31" };

  // Frozen at the end of the period so every March bill counts as "past".
  beforeEach(() => freezeToday("2026-03-31"));

  it("returns a perfect score when there are no past bills", () => {
    expect(calculateBillPaymentScore([], PERIOD.start, PERIOD.end)).toEqual({
      score: 100,
      rate: 100,
    });
  });

  it("counts a bill paid on its due date as on time", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          scheduledDate: "2026-03-10",
          actualDate: "2026-03-10",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("counts a bill paid before its due date as on time", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          scheduledDate: "2026-03-10",
          actualDate: "2026-03-08",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("scores a bill paid after its due date as entirely late", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          scheduledDate: "2026-03-10",
          actualDate: "2026-03-11",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 0, rate: 0 });
  });

  it("treats a completed bill with no actualDate as paid on its scheduled date", () => {
    const result = calculateBillPaymentScore(
      [completedWithoutActual({ scheduledDate: "2026-03-10", actualDate: undefined })],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("counts a skipped past bill in the denominator but never as on time", () => {
    // JUDGEMENT: debatable semantics — deliberately skipping an occurrence is
    // not the same as paying it late — but it is the documented intent, so it
    // is pinned rather than filed as a defect.
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({ id: "paid", scheduledDate: "2026-03-10" }),
        makeSkippedTransaction({ id: "skipped", scheduledDate: "2026-03-12" }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 50, rate: 50 });
  });

  it("rounds the score from the raw rate", () => {
    // 2 of 3 on time => 66.66...% => score 67.
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({ id: "a", scheduledDate: "2026-03-05" }),
        makeCompletedTransaction({ id: "b", scheduledDate: "2026-03-06" }),
        makeCompletedTransaction({
          id: "c",
          scheduledDate: "2026-03-07",
          actualDate: "2026-03-20",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result.rate).toBeCloseTo(66.6667, 3);
    expect(result.score).toBe(67);
  });

  it("ignores bills scheduled after today even when they are inside the period", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          id: "future",
          scheduledDate: "2026-04-05",
          actualDate: "2026-04-10",
        }),
      ],
      PERIOD.start,
      "2026-04-30"
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("ignores bills outside the period on both sides", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          id: "before",
          scheduledDate: "2026-02-20",
          actualDate: "2026-03-01",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("ignores income transactions", () => {
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-10",
          actualDate: "2026-03-20",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("ignores still-projected bills, so an unpaid overdue bill does not lower the score", () => {
    // Only `status !== "projected"` expenses are considered
    // (scoreCalculators.ts:131-140): a bill that came due on the 10th and was
    // never touched is invisible here, and the record stays perfect.
    const result = calculateBillPaymentScore(
      [makeProjectedTransaction({ id: "overdue", scheduledDate: "2026-03-10" })],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, rate: 100 });
  });

  it("filters on scheduledDate only, so a payment made after the period still counts", () => {
    // The window filter here uses `scheduledDate` (never `actualDate`), unlike
    // the savings-rate calculator, so this bill stays in the denominator even
    // though the money moved in April — and it is late.
    const result = calculateBillPaymentScore(
      [
        makeCompletedTransaction({
          scheduledDate: "2026-03-10",
          actualDate: "2026-04-02",
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 0, rate: 0 });
  });
});

// ============================================================================
// calculateBalanceTrendScore
// ============================================================================

describe("calculateBalanceTrendScore", () => {
  beforeEach(() => freezeToday(TODAY));

  const PERIOD = { start: "2026-03-01", end: "2026-03-31" };

  it("reports improving for a rising balance series", () => {
    // [1000, 1500, 2000, 2500]: slope 500, avg 1750 => normalized 28.6 =>
    // improving, score min(100, 70 + 286) = 100.
    const result = calculateBalanceTrendScore(
      dayBalances([
        ["2026-03-01", 1_000],
        ["2026-03-02", 1_500],
        ["2026-03-03", 2_000],
        ["2026-03-04", 2_500],
      ]),
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 100, trend: "improving" });
  });

  it("reports declining for a falling balance series", () => {
    // Mirror image: slope -500, avg 1750 => normalized -28.6 => declining,
    // score max(0, 30 - 286) = 0.
    const result = calculateBalanceTrendScore(
      dayBalances([
        ["2026-03-01", 2_500],
        ["2026-03-02", 2_000],
        ["2026-03-03", 1_500],
        ["2026-03-04", 1_000],
      ]),
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 0, trend: "declining" });
  });

  it("reports stable with a score of 65 for a flat balance series", () => {
    const result = calculateBalanceTrendScore(
      dayBalances([
        ["2026-03-01", 1_000],
        ["2026-03-02", 1_000],
        ["2026-03-03", 1_000],
      ]),
      PERIOD.start,
      PERIOD.end
    );

    expect(result).toEqual({ score: 65, trend: "stable" });
  });

  describe("insufficient data", () => {
    it("assumes stable with a score of 65 for a single data point", () => {
      expect(
        calculateBalanceTrendScore(dayBalances([["2026-03-01", 1_000]]), PERIOD.start, PERIOD.end)
      ).toEqual({ score: 65, trend: "stable" });
    });

    it("assumes stable with a score of 65 for an empty map", () => {
      expect(calculateBalanceTrendScore(dayBalances([]), PERIOD.start, PERIOD.end)).toEqual({
        score: 65,
        trend: "stable",
      });
    });

    it("assumes stable when only one point falls inside the period", () => {
      expect(
        calculateBalanceTrendScore(
          dayBalances([
            ["2026-02-01", 5_000],
            ["2026-03-01", 1_000],
            ["2026-04-01", 100],
          ]),
          PERIOD.start,
          PERIOD.end
        )
      ).toEqual({ score: 65, trend: "stable" });
    });
  });

  describe("period filtering", () => {
    it("uses only the days inside [startDate, endDate]", () => {
      // The full series [10000, 1000, 1500, 2000, 100] trends down; the three
      // March days alone trend up. The in-period trend must win.
      const result = calculateBalanceTrendScore(
        dayBalances([
          ["2026-02-01", 10_000],
          ["2026-03-01", 1_000],
          ["2026-03-02", 1_500],
          ["2026-03-03", 2_000],
          ["2026-04-01", 100],
        ]),
        PERIOD.start,
        PERIOD.end
      );

      expect(result).toEqual({ score: 100, trend: "improving" });
    });

    it("includes both boundary days of the period", () => {
      const result = calculateBalanceTrendScore(
        dayBalances([
          ["2026-03-01", 199],
          ["2026-03-31", 201],
        ]),
        PERIOD.start,
        PERIOD.end
      );

      // Two points 199 -> 201: slope 2, avg 200 => normalized 1.0.
      expect(result).toEqual({ score: 80, trend: "improving" });
    });
  });

  describe("normalized slope thresholds", () => {
    it("calls a normalized slope of exactly +0.5 stable, since the test is strictly greater", () => {
      // 199.5 -> 200.5: slope 1, avg 200 => normalized exactly 0.5.
      expect(
        calculateBalanceTrendScore(
          dayBalances([
            ["2026-03-01", 199.5],
            ["2026-03-02", 200.5],
          ]),
          PERIOD.start,
          PERIOD.end
        )
      ).toEqual({ score: 65, trend: "stable" });
    });

    it("calls a normalized slope of exactly -0.5 stable as well", () => {
      expect(
        calculateBalanceTrendScore(
          dayBalances([
            ["2026-03-01", 200.5],
            ["2026-03-02", 199.5],
          ]),
          PERIOD.start,
          PERIOD.end
        )
      ).toEqual({ score: 65, trend: "stable" });
    });

    it("scores improving as 70 + normalizedSlope * 10 just past the threshold", () => {
      // 199 -> 201: normalized 1.0 => 70 + 10 = 80.
      expect(
        calculateBalanceTrendScore(
          dayBalances([
            ["2026-03-01", 199],
            ["2026-03-02", 201],
          ]),
          PERIOD.start,
          PERIOD.end
        )
      ).toEqual({ score: 80, trend: "improving" });
    });

    it("scores declining as 30 + normalizedSlope * 10 just past the threshold", () => {
      // 201 -> 199: normalized -1.0 => 30 - 10 = 20.
      expect(
        calculateBalanceTrendScore(
          dayBalances([
            ["2026-03-01", 201],
            ["2026-03-02", 199],
          ]),
          PERIOD.start,
          PERIOD.end
        )
      ).toEqual({ score: 20, trend: "declining" });
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: the slope is normalized by the average balance, and when that
     * average is 0 the normalization is short-circuited to 0
     * (app/lib/logic/healthScore/scoreCalculators.ts:201-202), which lands in
     * the `stable` branch no matter how steep the real trend is.
     *
     * A balance climbing from -1,000 to +1,000 — the single most improving
     * thing a series can do — averages 0 and is reported as
     * `{ score: 65, trend: "stable" }`.
     *
     * CORRECT: the trend must follow the sign of the slope; recovering from
     * overdraft is "improving".
     */
    it.fails("KNOWN DEFECT: reports a balance rising through zero as improving", () => {
      const result = calculateBalanceTrendScore(
        dayBalances([
          ["2026-03-01", -1_000],
          ["2026-03-02", 1_000],
        ]),
        PERIOD.start,
        PERIOD.end
      );

      expect(result.trend).toBe("improving");
    });

    /**
     * DEFECT: the closing balances are collected by iterating the Map and
     * pushing in ITERATION order (scoreCalculators.ts:174-178), which for a
     * Map is insertion order — the date key is only used to test range
     * membership, never to order the series. The regression is then run over
     * whatever order the caller happened to build the map in.
     *
     * Here the map is inserted 03-03, 03-01, 03-02 with chronologically rising
     * balances 1,000 -> 2,000 -> 3,000; the series becomes [3000, 1000, 2000]
     * and is reported as declining.
     *
     * CORRECT: sort the collected days by date before regressing.
     */
    it.fails("KNOWN DEFECT: orders the series by date, not by map insertion order", () => {
      const result = calculateBalanceTrendScore(
        dayBalances([
          ["2026-03-03", 3_000],
          ["2026-03-01", 1_000],
          ["2026-03-02", 2_000],
        ]),
        PERIOD.start,
        PERIOD.end
      );

      expect(result.trend).toBe("improving");
    });
  });
});

// ============================================================================
// getPeriodStats
// ============================================================================

describe("getPeriodStats", () => {
  beforeEach(() => freezeToday(TODAY));

  const PERIOD = { start: "2026-03-01", end: "2026-03-31" };

  it("counts, buckets and totals a mixed period", () => {
    const stats = getPeriodStats(
      [
        makeProjectedTransaction({
          id: "future-pay",
          type: "income",
          scheduledDate: "2026-03-01",
          projectedAmount: 3_000,
        }),
        makeCompletedTransaction({
          id: "paid-in",
          type: "income",
          scheduledDate: "2026-03-05",
          projectedAmount: 2_000,
          actualAmount: 2_100,
        }),
        makeCompletedTransaction({
          id: "paid-out",
          scheduledDate: "2026-03-09",
          actualDate: "2026-03-10",
          projectedAmount: 500,
          actualAmount: 450,
        }),
        makeProjectedTransaction({
          id: "upcoming",
          scheduledDate: "2026-03-20",
          projectedAmount: 700,
        }),
        makeSkippedTransaction({
          id: "skipped",
          scheduledDate: "2026-03-22",
          projectedAmount: 900,
        }),
        makeCompletedTransaction({
          id: "settled-in-april",
          scheduledDate: "2026-03-28",
          actualDate: "2026-04-02",
          projectedAmount: 300,
          actualAmount: 300,
        }),
        makeProjectedTransaction({
          id: "february",
          scheduledDate: "2026-02-28",
          projectedAmount: 100,
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    // Income: 3,000 projected + 2,100 actual. Expenses: 450 actual + 700
    // projected. The 300 expense is bucketed into April by its actualDate and
    // the February one is out of range; the skipped 900 is counted but not
    // summed.
    expect(stats).toEqual({
      income: 5_100,
      expenses: 1_150,
      net: 3_950,
      transactionCount: 5,
      completedCount: 2,
      skippedCount: 1,
    });
  });

  it("counts skipped transactions in transactionCount as well as skippedCount", () => {
    const stats = getPeriodStats(
      [makeSkippedTransaction({ scheduledDate: "2026-03-15", projectedAmount: 900 })],
      PERIOD.start,
      PERIOD.end
    );

    expect(stats).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
      transactionCount: 1,
      completedCount: 0,
      skippedCount: 1,
    });
  });

  it("includes both boundary days of the period", () => {
    const stats = getPeriodStats(
      [
        makeProjectedTransaction({ id: "first", scheduledDate: "2026-03-01", projectedAmount: 10 }),
        makeProjectedTransaction({ id: "last", scheduledDate: "2026-03-31", projectedAmount: 20 }),
        makeProjectedTransaction({
          id: "before",
          scheduledDate: "2026-02-28",
          projectedAmount: 40,
        }),
        makeProjectedTransaction({ id: "after", scheduledDate: "2026-04-01", projectedAmount: 80 }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(stats.expenses).toBe(30);
    expect(stats.transactionCount).toBe(2);
  });

  it("falls back to projectedAmount for a completed transaction with no actualAmount", () => {
    const stats = getPeriodStats(
      [completedWithoutActual({ scheduledDate: "2026-03-15", projectedAmount: 250 })],
      PERIOD.start,
      PERIOD.end
    );

    expect(stats.expenses).toBe(250);
    expect(stats.completedCount).toBe(1);
  });

  it("returns zeroes for an empty period", () => {
    expect(getPeriodStats([], PERIOD.start, PERIOD.end)).toEqual({
      income: 0,
      expenses: 0,
      net: 0,
      transactionCount: 0,
      completedCount: 0,
      skippedCount: 0,
    });
  });

  it("reports a negative net when expenses outrun income", () => {
    const stats = getPeriodStats(
      [
        makeProjectedTransaction({
          id: "pay",
          type: "income",
          scheduledDate: "2026-03-05",
          projectedAmount: 1_000,
        }),
        makeProjectedTransaction({
          id: "spend",
          scheduledDate: "2026-03-06",
          projectedAmount: 1_400,
        }),
      ],
      PERIOD.start,
      PERIOD.end
    );

    expect(stats.net).toBe(-400);
  });
});

// ============================================================================
// calculateHealthScore (composite)
// ============================================================================

describe("calculateHealthScore", () => {
  const PERIOD = { start: "2026-03-01", end: "2026-03-31" };

  beforeEach(() => freezeToday("2026-03-31"));

  /** A clean March: 5,000 earned, 2,000 spent, paid on time. */
  const cleanMonth = (): Transaction[] => [
    makeCompletedTransaction({
      id: "pay",
      type: "income",
      scheduledDate: "2026-03-01",
      actualDate: "2026-03-01",
      projectedAmount: 5_000,
      actualAmount: 5_000,
    }),
    makeCompletedTransaction({
      id: "rent",
      scheduledDate: "2026-03-05",
      actualDate: "2026-03-05",
      projectedAmount: 2_000,
      actualAmount: 2_000,
    }),
  ];

  /** Flat balances: two in-period points => trend "stable", score 65. */
  const flatBalances = () =>
    dayBalances([
      ["2026-03-01", 10_000],
      ["2026-03-31", 10_000],
    ]);

  it("weights the four components 30/30/20/20", () => {
    // runway 100 (completed bills are excluded, so nothing overdraws the
    // 10,000), savings 100 (60% rate), bill payment 100 (one bill, on time),
    // trend 65 (flat) => round(30 + 30 + 20 + 13) = 93.
    const result = calculateHealthScore(
      10_000,
      cleanMonth(),
      flatBalances(),
      PERIOD.start,
      PERIOD.end
    );

    expect(result.components).toEqual({
      runway: 100,
      savingsRate: 100,
      billPaymentRate: 100,
      balanceTrend: 65,
    });
    expect(result.score).toBe(93);
    expect(result.grade).toBe("A");
    expect(result.color).toBe("#22c55e");
  });

  it("drops the overall score by exactly 30 points when the runway component collapses", () => {
    // Same month plus a projected 20,000 bill on 2026-04-01: it is outside the
    // savings/bill-payment period, so ONLY the runway component moves — from
    // 100 to 0 (the balance goes negative on day 1). round(0 + 30 + 20 + 13)
    // = 63, i.e. exactly 30% of 100 removed from the 93 above.
    const result = calculateHealthScore(
      10_000,
      [
        ...cleanMonth(),
        makeProjectedTransaction({
          id: "big-bill",
          scheduledDate: "2026-04-01",
          projectedAmount: 20_000,
        }),
      ],
      flatBalances(),
      PERIOD.start,
      PERIOD.end
    );

    expect(result.components).toEqual({
      runway: 0,
      savingsRate: 100,
      billPaymentRate: 100,
      balanceTrend: 65,
    });
    expect(result.score).toBe(63);
    expect(result.grade).toBe("D");
    expect(result.color).toBe("#eab308");
  });

  it("surfaces at most three insights, driven by the component inputs", () => {
    const result = calculateHealthScore(
      10_000,
      cleanMonth(),
      flatBalances(),
      PERIOD.start,
      PERIOD.end
    );

    expect(result.insights).toEqual([
      "Great cash runway! You have 90+ days of expenses covered.",
      "Excellent savings rate! You're building wealth effectively.",
      "Perfect bill payment record!",
    ]);
  });

  it("scores an empty month on its neutral defaults", () => {
    // runway 100 (nothing to spend), savings 100 (no transactions), bill
    // payment 100 (no past bills), trend 65 (insufficient data) =>
    // round(30 + 30 + 20 + 13) = 93.
    const result = calculateHealthScore(10_000, [], new Map(), PERIOD.start, PERIOD.end);

    expect(result.score).toBe(93);
    expect(result.grade).toBe("A");
    expect(result.insights).toContain("No income or expenses recorded for this period.");
  });
});

describe("getGrade", () => {
  beforeEach(() => freezeToday(TODAY));

  it("puts each letter boundary on the inclusive lower bound", () => {
    expect([90, 89, 80, 79, 70, 69, 60, 59, 0].map(getGrade)).toEqual([
      "A",
      "B",
      "B",
      "C",
      "C",
      "D",
      "D",
      "F",
      "F",
    ]);
  });
});

describe("getScoreColor", () => {
  beforeEach(() => freezeToday(TODAY));

  it("switches colour on the inclusive lower bound of each band", () => {
    expect([100, 80, 79, 60, 59, 40, 39, 0].map(getScoreColor)).toEqual([
      "#22c55e",
      "#22c55e",
      "#eab308",
      "#eab308",
      "#f97316",
      "#f97316",
      "#ef4444",
      "#ef4444",
    ]);
  });
});

// ============================================================================
// frequencyUtils
// ============================================================================

describe("getMonthlyMultiplier", () => {
  beforeEach(() => freezeToday(TODAY));

  it("maps every frequency to its monthly equivalent", () => {
    expect(getMonthlyMultiplier("daily")).toBe(30);
    expect(getMonthlyMultiplier("weekly")).toBe(52 / 12);
    expect(getMonthlyMultiplier("bi-weekly")).toBe(26 / 12);
    expect(getMonthlyMultiplier("semi-monthly")).toBe(2);
    expect(getMonthlyMultiplier("monthly")).toBe(1);
    expect(getMonthlyMultiplier("quarterly")).toBe(1 / 3);
    expect(getMonthlyMultiplier("yearly")).toBe(1 / 12);
    expect(getMonthlyMultiplier("one-time")).toBe(0);
  });

  it("uses 52/12 for weekly and 26/12 for bi-weekly, not a rounded 4.33 / 2.17", () => {
    expect(getMonthlyMultiplier("weekly")).toBeCloseTo(4.333333, 6);
    expect(getMonthlyMultiplier("bi-weekly")).toBeCloseTo(2.166667, 6);
    // 12 weekly payments' worth of months is exactly 52 weekly payments.
    expect(getMonthlyMultiplier("weekly") * 12).toBeCloseTo(52, 10);
    expect(getMonthlyMultiplier("bi-weekly") * 12).toBeCloseTo(26, 10);
  });

  it("contributes nothing monthly for a one-time amount", () => {
    expect(1_200 * getMonthlyMultiplier("one-time")).toBe(0);
  });
});

describe("prorateToDateRange", () => {
  beforeEach(() => freezeToday(TODAY));

  /**
   * NOTE: this helper parses its bounds with `new Date(str)`
   * (frequencyUtils.ts:49-50), which reads "YYYY-MM-DD" as UTC midnight. Under
   * this suite's pinned TZ=UTC that is indistinguishable from local midnight;
   * the offset behaviour belongs to the timezone suite.
   */

  it("returns the full monthly amount for an inclusive 30-day range", () => {
    // 2026-03-01 .. 2026-03-30 is 30 days inclusive.
    expect(prorateToDateRange(3_000, "2026-03-01", "2026-03-30")).toBe(3_000);
  });

  it("returns half the monthly amount for a 15-day range", () => {
    expect(prorateToDateRange(3_000, "2026-03-01", "2026-03-15")).toBe(1_500);
  });

  it("returns a single day as one thirtieth", () => {
    expect(prorateToDateRange(3_000, "2026-03-01", "2026-03-01")).toBe(100);
  });

  it("assumes a fixed 30-day month, so a 31-day month prorates above the monthly amount", () => {
    // 31 inclusive days / 30 => 3,100. The fixed divisor is deliberate
    // ("Use 30-day month for consistency") but it does mean the sum of a
    // year's prorated months does not equal 12 monthly amounts.
    expect(prorateToDateRange(3_000, "2026-03-01", "2026-03-31")).toBe(3_100);
  });

  it("prorates a 28-day February below the monthly amount", () => {
    expect(prorateToDateRange(3_000, "2026-02-01", "2026-02-28")).toBe(2_800);
  });

  it("scales linearly across a month boundary", () => {
    // 2026-03-20 .. 2026-04-08 is 20 inclusive days => 3,000 / 30 * 20.
    expect(prorateToDateRange(3_000, "2026-03-20", "2026-04-08")).toBe(2_000);
  });

  it("returns zero for a zero monthly amount", () => {
    expect(prorateToDateRange(0, "2026-03-01", "2026-03-30")).toBe(0);
  });

  it("returns a negative amount for an inverted range, with no validation", () => {
    // end before start => daysDiff -13. Pinned so a future guard is a visible
    // behaviour change rather than a silent one.
    expect(prorateToDateRange(3_000, "2026-03-15", "2026-03-01")).toBe((3_000 / 30) * -13);
  });
});
