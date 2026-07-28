import { describe, expect, it } from "vitest";
import type { HealthScoreBreakdown, TrendDirection } from "@/lib/logic/healthScore/types";
import { generateInsights, getGrade, getScoreColor } from "@/lib/logic/healthScore/insights";
import { getBestBucketType, getIncomeExpenseChartData } from "@/lib/logic/healthScore/chartData";
import {
  makeCompletedTransaction,
  makeSkippedTransaction,
  makeTransaction,
} from "../../helpers/builders";

/**
 * The two healthScore modules the rest of the suite only reaches transitively.
 *
 * `insights.ts` is normally called from inside `calculateHealthScore`, which can
 * only produce a handful of its branches; it is driven DIRECTLY here so every
 * band is reachable. `chartData.ts` had no coverage at all despite being live
 * (IncomeExpenseChart.tsx:95).
 *
 * The component scores in `calculateRunwayScore` etc. are covered in
 * tests/integration/projectedVsActual.forwardLooking.test.ts and are not
 * re-covered here.
 */

// ============================================================================
// Local helpers
// ============================================================================

const components = (
  overrides: Partial<HealthScoreBreakdown["components"]> = {}
): HealthScoreBreakdown["components"] => ({
  runway: 60,
  savingsRate: 60,
  billPaymentRate: 90,
  balanceTrend: 65,
  ...overrides,
});

/**
 * Named arguments over generateInsights' five positional parameters.
 *
 * Every default sits in a band that produces NO insight (runway 30-89, savings
 * 10-19.99, bills 80-99.99, trend stable), so a test that overrides one input
 * sees only that band's message. This matters because the function truncates to
 * three: praise-producing defaults would fill the slice and silently hide the
 * band under test — which is itself a defect encoded further down.
 */
const insightsFor = (args: {
  components?: Partial<HealthScoreBreakdown["components"]>;
  savingsRate?: number;
  runwayDays?: number;
  billPaymentRate?: number;
  trend?: TrendDirection;
}): string[] =>
  generateInsights(
    components(args.components),
    args.savingsRate ?? 15,
    args.runwayDays ?? 60,
    args.billPaymentRate ?? 90,
    args.trend ?? "stable"
  );

const RUNWAY_CRITICAL = "Your cash runway is critically low. Consider reducing expenses.";
const RUNWAY_LOW = "Your cash runway is low. Try to build a buffer.";
const RUNWAY_GREAT = "Great cash runway! You have 90+ days of expenses covered.";
const SPENDING_OVER = "You're spending more than you earn. Review your expenses.";
const NO_ACTIVITY = "No income or expenses recorded for this period.";
const SAVINGS_LOW = "Try to increase your savings rate to at least 10%.";
const SAVINGS_GREAT = "Excellent savings rate! You're building wealth effectively.";
const BILLS_LATE = "Improve bill payment timing to avoid late fees.";
const BILLS_PERFECT = "Perfect bill payment record!";
const TREND_DOWN = "Your balance is trending downward. Monitor your spending.";
const TREND_UP = "Your balance is trending upward. Keep it up!";

// ============================================================================
// generateInsights — runway band
// ============================================================================

describe("generateInsights: runway band", () => {
  it("warns critically below 14 days", () => {
    expect(insightsFor({ runwayDays: 13 })).toContain(RUNWAY_CRITICAL);
  });

  it("treats 0 days as critical", () => {
    expect(insightsFor({ runwayDays: 0 })).toContain(RUNWAY_CRITICAL);
  });

  it("switches from critical to low at exactly 14 days", () => {
    expect(insightsFor({ runwayDays: 14 })).toContain(RUNWAY_LOW);
    expect(insightsFor({ runwayDays: 14 })).not.toContain(RUNWAY_CRITICAL);
  });

  it("warns of a low buffer up to 29 days", () => {
    expect(insightsFor({ runwayDays: 29 })).toContain(RUNWAY_LOW);
  });

  it("says nothing about runway between 30 and 89 days", () => {
    // The band is deliberately silent: not alarming, not praiseworthy.
    [30, 60, 89].forEach((runwayDays) => {
      const insights = insightsFor({ runwayDays });
      expect(insights).not.toContain(RUNWAY_CRITICAL);
      expect(insights).not.toContain(RUNWAY_LOW);
      expect(insights).not.toContain(RUNWAY_GREAT);
    });
  });

  it("praises 90 days or more", () => {
    expect(insightsFor({ runwayDays: 90 })).toContain(RUNWAY_GREAT);
    expect(insightsFor({ runwayDays: 365 })).toContain(RUNWAY_GREAT);
  });
});

// ============================================================================
// generateInsights — savings band
// ============================================================================

describe("generateInsights: savings band", () => {
  it("warns when the savings rate is negative", () => {
    expect(insightsFor({ savingsRate: -0.01 })).toContain(SPENDING_OVER);
    expect(insightsFor({ savingsRate: -50 })).toContain(SPENDING_OVER);
  });

  it("reports no activity when the rate is 0 and the component score is a perfect 100", () => {
    // calculateSavingsRateScore returns {score: 100, rate: 0} for a period with
    // no transactions at all, so the pair (0, 100) is the no-data signal rather
    // than a genuine zero-savings month.
    const insights = insightsFor({
      savingsRate: 0,
      components: { savingsRate: 100 },
    });
    expect(insights).toContain(NO_ACTIVITY);
    expect(insights).not.toContain(SAVINGS_LOW);
  });

  it("treats a real zero-savings month as low savings, not as no activity", () => {
    // Same rate of 0, but the component score is 20 (the >= 0 band), which is
    // what a month that spent exactly what it earned produces.
    const insights = insightsFor({ savingsRate: 0, components: { savingsRate: 20 } });
    expect(insights).toContain(SAVINGS_LOW);
    expect(insights).not.toContain(NO_ACTIVITY);
  });

  it("nudges below a 10% savings rate", () => {
    expect(insightsFor({ savingsRate: 9.99, components: { savingsRate: 40 } })).toContain(
      SAVINGS_LOW
    );
  });

  it("says nothing between 10% and 19.99%", () => {
    [10, 15, 19.99].forEach((savingsRate) => {
      const insights = insightsFor({ savingsRate, components: { savingsRate: 60 } });
      expect(insights).not.toContain(SAVINGS_LOW);
      expect(insights).not.toContain(SAVINGS_GREAT);
      expect(insights).not.toContain(SPENDING_OVER);
    });
  });

  it("praises 20% or more", () => {
    expect(insightsFor({ savingsRate: 20 })).toContain(SAVINGS_GREAT);
    expect(insightsFor({ savingsRate: 75 })).toContain(SAVINGS_GREAT);
  });
});

// ============================================================================
// generateInsights — bills and trend
// ============================================================================

describe("generateInsights: bill payment band", () => {
  it("warns below an 80% on-time rate", () => {
    expect(insightsFor({ billPaymentRate: 79.9 })).toContain(BILLS_LATE);
    expect(insightsFor({ billPaymentRate: 0 })).toContain(BILLS_LATE);
  });

  it("says nothing between 80% and 99.99%", () => {
    [80, 90, 99.99].forEach((billPaymentRate) => {
      const insights = insightsFor({ billPaymentRate });
      expect(insights).not.toContain(BILLS_LATE);
      expect(insights).not.toContain(BILLS_PERFECT);
    });
  });

  it("praises only an exactly perfect record", () => {
    expect(insightsFor({ billPaymentRate: 100 })).toContain(BILLS_PERFECT);
  });
});

describe("generateInsights: trend band", () => {
  it("warns on a declining balance", () => {
    expect(insightsFor({ trend: "declining" })).toContain(TREND_DOWN);
  });

  it("praises an improving balance", () => {
    expect(insightsFor({ trend: "improving" })).toContain(TREND_UP);
  });

  it("says nothing when stable", () => {
    const insights = insightsFor({ trend: "stable" });
    expect(insights).not.toContain(TREND_DOWN);
    expect(insights).not.toContain(TREND_UP);
  });
});

// ============================================================================
// generateInsights — truncation
// ============================================================================

describe("generateInsights: truncation to three", () => {
  it("never returns more than three insights", () => {
    const insights = insightsFor({
      runwayDays: 5,
      savingsRate: -20,
      billPaymentRate: 40,
      trend: "declining",
    });
    expect(insights).toHaveLength(3);
  });

  it("keeps insights in source push order: runway, savings, bills, trend", () => {
    // The order is determined solely by the order of the push calls in
    // insights.ts:26-59, NOT by severity. With all four bands firing, the trend
    // insight is the one dropped.
    const insights = insightsFor({
      runwayDays: 5,
      savingsRate: -20,
      billPaymentRate: 40,
      trend: "declining",
    });
    expect(insights).toEqual([RUNWAY_CRITICAL, SPENDING_OVER, BILLS_LATE]);
    expect(insights).not.toContain(TREND_DOWN);
  });

  it("returns fewer than three when only some bands fire", () => {
    expect(insightsFor({ runwayDays: 45, savingsRate: 15, billPaymentRate: 90 })).toEqual([]);
    expect(
      insightsFor({ runwayDays: 45, savingsRate: 15, billPaymentRate: 95, trend: "improving" })
    ).toEqual([TREND_UP]);
  });

  it("returns an empty array when nothing is noteworthy", () => {
    // Runway in the silent 30-89 band, savings in the silent 10-19 band, bills
    // in the silent 80-99 band, trend stable.
    expect(
      insightsFor({
        runwayDays: 60,
        savingsRate: 15,
        billPaymentRate: 90,
        trend: "stable",
        components: { savingsRate: 60 },
      })
    ).toEqual([]);
  });

  describe("known defects", () => {
    /**
     * DEFECT: the truncation is push-order, not severity-order, so three pieces
     * of PRAISE can crowd out the only warning.
     *
     * This user has a great runway, an excellent savings rate and a perfect bill
     * record, but their balance is trending downward. All four bands fire, and
     * `.slice(0, 3)` (insights.ts:61) keeps the three compliments and discards
     * the warning — the user is shown nothing but praise while their balance
     * declines.
     *
     * CORRECT: a warning must never be dropped in favour of a compliment. The
     * declining-balance insight should survive truncation.
     */
    it.fails("KNOWN DEFECT: drops the only warning in favour of three compliments", () => {
      const insights = insightsFor({
        runwayDays: 120,
        savingsRate: 30,
        billPaymentRate: 100,
        trend: "declining",
      });

      expect(insights).toHaveLength(3);
      expect(insights).toContain(TREND_DOWN);
    });

    /**
     * DEFECT: the same ordering problem in its mildest form. A user whose bills
     * are late and whose balance is falling still gets told about their good
     * runway and savings first, so only one of their two real problems is shown.
     *
     * CORRECT: both warnings should be visible before any praise.
     */
    it.fails("KNOWN DEFECT: shows praise ahead of a second warning", () => {
      const insights = insightsFor({
        runwayDays: 120,
        savingsRate: 30,
        billPaymentRate: 50,
        trend: "declining",
      });

      expect(insights).toEqual(expect.arrayContaining([BILLS_LATE, TREND_DOWN]));
    });
  });
});

// ============================================================================
// getGrade / getScoreColor
// ============================================================================

describe("getGrade", () => {
  it("maps each band boundary to its letter", () => {
    expect(getGrade(100)).toBe("A");
    expect(getGrade(90)).toBe("A");
    expect(getGrade(89.99)).toBe("B");
    expect(getGrade(80)).toBe("B");
    expect(getGrade(79.99)).toBe("C");
    expect(getGrade(70)).toBe("C");
    expect(getGrade(69.99)).toBe("D");
    expect(getGrade(60)).toBe("D");
    expect(getGrade(59.99)).toBe("F");
    expect(getGrade(0)).toBe("F");
  });

  it("grades a negative score F rather than throwing", () => {
    expect(getGrade(-10)).toBe("F");
  });
});

describe("getScoreColor", () => {
  it("maps each band boundary to its colour", () => {
    expect(getScoreColor(100)).toBe("#22c55e");
    expect(getScoreColor(80)).toBe("#22c55e");
    expect(getScoreColor(79.99)).toBe("#eab308");
    expect(getScoreColor(60)).toBe("#eab308");
    expect(getScoreColor(59.99)).toBe("#f97316");
    expect(getScoreColor(40)).toBe("#f97316");
    expect(getScoreColor(39.99)).toBe("#ef4444");
    expect(getScoreColor(0)).toBe("#ef4444");
  });

  it("uses different colour boundaries from the letter grades", () => {
    // A score of 70 is a C but still yellow, and 40 is an F but orange. Worth
    // pinning so a change to one scale does not silently desync the other.
    expect(getGrade(70)).toBe("C");
    expect(getScoreColor(70)).toBe("#eab308");
    expect(getGrade(40)).toBe("F");
    expect(getScoreColor(40)).toBe("#f97316");
  });
});

// ============================================================================
// getBestBucketType
// ============================================================================

describe("getBestBucketType", () => {
  it("buckets daily up to and including a 14-day span", () => {
    expect(getBestBucketType("2026-03-01", "2026-03-15")).toBe("daily"); // 14 days
    expect(getBestBucketType("2026-03-01", "2026-03-01")).toBe("daily"); // 0 days
  });

  it("switches to weekly at 15 days", () => {
    expect(getBestBucketType("2026-03-01", "2026-03-16")).toBe("weekly");
  });

  it("stays weekly up to and including a 90-day span", () => {
    expect(getBestBucketType("2026-03-01", "2026-05-30")).toBe("weekly"); // 90 days
  });

  it("switches to monthly at 91 days", () => {
    expect(getBestBucketType("2026-03-01", "2026-05-31")).toBe("monthly");
  });

  it("buckets a full year monthly", () => {
    expect(getBestBucketType("2026-01-01", "2026-12-31")).toBe("monthly");
  });

  it("returns daily for an inverted range rather than throwing", () => {
    // A negative day count falls through the <= 14 test.
    expect(getBestBucketType("2026-05-01", "2026-03-01")).toBe("daily");
  });
});

// ============================================================================
// getIncomeExpenseChartData
// ============================================================================

describe("getIncomeExpenseChartData", () => {
  it("returns an empty array for no transactions", () => {
    expect(getIncomeExpenseChartData([], "2026-03-01", "2026-03-31")).toEqual([]);
  });

  it("buckets one transaction per day by default", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "a",
          type: "income",
          projectedAmount: 500,
          scheduledDate: "2026-03-02",
        }),
        makeTransaction({
          id: "b",
          type: "expense",
          projectedAmount: 120,
          scheduledDate: "2026-03-03",
        }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data).toEqual([
      { label: "Mar 2", date: "2026-03-02", income: 500, expenses: 0, net: 500 },
      { label: "Mar 3", date: "2026-03-03", income: 0, expenses: 120, net: -120 },
    ]);
  });

  it("sums income and expenses landing on the same day into one point", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "a",
          type: "income",
          projectedAmount: 500,
          scheduledDate: "2026-03-02",
        }),
        makeTransaction({
          id: "b",
          type: "income",
          projectedAmount: 250,
          scheduledDate: "2026-03-02",
        }),
        makeTransaction({
          id: "c",
          type: "expense",
          projectedAmount: 100,
          scheduledDate: "2026-03-02",
        }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ date: "2026-03-02", income: 750, expenses: 100, net: 650 });
  });

  it("excludes transactions outside the range, inclusive of both bounds", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({ id: "before", projectedAmount: 1, scheduledDate: "2026-02-28" }),
        makeTransaction({ id: "start", projectedAmount: 2, scheduledDate: "2026-03-01" }),
        makeTransaction({ id: "end", projectedAmount: 3, scheduledDate: "2026-03-31" }),
        makeTransaction({ id: "after", projectedAmount: 4, scheduledDate: "2026-04-01" }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data.map((point) => point.date)).toEqual(["2026-03-01", "2026-03-31"]);
    expect(data.map((point) => point.expenses)).toEqual([2, 3]);
  });

  it("excludes skipped transactions", () => {
    const data = getIncomeExpenseChartData(
      [
        makeSkippedTransaction({ id: "s", projectedAmount: 999, scheduledDate: "2026-03-05" }),
        makeTransaction({ id: "k", projectedAmount: 10, scheduledDate: "2026-03-05" }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data).toHaveLength(1);
    expect(data[0].expenses).toBe(10);
  });

  // The projected-vs-actual contract, asserted here too because this module
  // makes the choice independently of the balance calculators.
  it("uses actualAmount for a completed transaction and projectedAmount otherwise", () => {
    const data = getIncomeExpenseChartData(
      [
        makeCompletedTransaction({
          id: "done",
          projectedAmount: 100,
          actualAmount: 175,
          scheduledDate: "2026-03-04",
        }),
        makeTransaction({ id: "todo", projectedAmount: 60, scheduledDate: "2026-03-05" }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data.map((point) => point.expenses)).toEqual([175, 60]);
  });

  it("falls back to projectedAmount when a completed transaction has no actualAmount", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "done",
          status: "completed",
          projectedAmount: 90,
          actualAmount: undefined,
          scheduledDate: "2026-03-04",
        }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data[0].expenses).toBe(90);
  });

  it("buckets a completed transaction on its actualDate, not its scheduledDate", () => {
    const data = getIncomeExpenseChartData(
      [
        makeCompletedTransaction({
          id: "late",
          projectedAmount: 200,
          actualAmount: 200,
          scheduledDate: "2026-03-05",
          actualDate: "2026-03-09",
        }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data.map((point) => point.date)).toEqual(["2026-03-09"]);
  });

  it("groups weekly buckets onto the preceding Sunday", () => {
    // 2026-03-16 (Mon), 03-18 (Wed) and 03-22 (Sun) — the first two share the
    // week beginning Sunday 2026-03-15, the third opens a new one.
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "a",
          type: "income",
          projectedAmount: 100,
          scheduledDate: "2026-03-16",
        }),
        makeTransaction({
          id: "b",
          type: "income",
          projectedAmount: 50,
          scheduledDate: "2026-03-18",
        }),
        makeTransaction({
          id: "c",
          type: "income",
          projectedAmount: 25,
          scheduledDate: "2026-03-22",
        }),
      ],
      "2026-03-01",
      "2026-03-31",
      "weekly"
    );

    expect(data).toEqual([
      { label: "Week of Mar 15", date: "2026-03-15", income: 150, expenses: 0, net: 150 },
      { label: "Week of Mar 22", date: "2026-03-22", income: 25, expenses: 0, net: 25 },
    ]);
  });

  it("keeps a Sunday transaction in its own week", () => {
    const data = getIncomeExpenseChartData(
      [makeTransaction({ id: "a", projectedAmount: 10, scheduledDate: "2026-03-15" })],
      "2026-03-01",
      "2026-03-31",
      "weekly"
    );

    expect(data[0].date).toBe("2026-03-15");
  });

  it("carries a weekly bucket back across a month boundary", () => {
    // 2026-04-01 is a Wednesday, so its week begins Sunday 2026-03-29 — the
    // bucket key leaves the requested month even though the transaction is in it.
    const data = getIncomeExpenseChartData(
      [makeTransaction({ id: "a", projectedAmount: 10, scheduledDate: "2026-04-01" })],
      "2026-04-01",
      "2026-04-30",
      "weekly"
    );

    expect(data[0].date).toBe("2026-03-29");
  });

  it("groups monthly buckets by year and month", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "a",
          type: "income",
          projectedAmount: 300,
          scheduledDate: "2026-03-02",
        }),
        makeTransaction({
          id: "b",
          type: "expense",
          projectedAmount: 120,
          scheduledDate: "2026-03-28",
        }),
        makeTransaction({
          id: "c",
          type: "income",
          projectedAmount: 400,
          scheduledDate: "2026-04-10",
        }),
      ],
      "2026-03-01",
      "2026-04-30",
      "monthly"
    );

    expect(data).toEqual([
      { label: "Mar 2026", date: "2026-03", income: 300, expenses: 120, net: 180 },
      { label: "Apr 2026", date: "2026-04", income: 400, expenses: 0, net: 400 },
    ]);
  });

  it("sorts points chronologically regardless of input order", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({ id: "c", projectedAmount: 3, scheduledDate: "2026-03-20" }),
        makeTransaction({ id: "a", projectedAmount: 1, scheduledDate: "2026-03-02" }),
        makeTransaction({ id: "b", projectedAmount: 2, scheduledDate: "2026-03-11" }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data.map((point) => point.date)).toEqual(["2026-03-02", "2026-03-11", "2026-03-20"]);
  });

  it("sorts monthly buckets correctly across a year boundary", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({ id: "a", projectedAmount: 1, scheduledDate: "2027-01-05" }),
        makeTransaction({ id: "b", projectedAmount: 2, scheduledDate: "2026-12-05" }),
      ],
      "2026-12-01",
      "2027-01-31",
      "monthly"
    );

    expect(data.map((point) => point.date)).toEqual(["2026-12", "2027-01"]);
  });

  it("keeps net as income minus expenses, including when negative", () => {
    const data = getIncomeExpenseChartData(
      [
        makeTransaction({
          id: "a",
          type: "income",
          projectedAmount: 100,
          scheduledDate: "2026-03-02",
        }),
        makeTransaction({
          id: "b",
          type: "expense",
          projectedAmount: 250,
          scheduledDate: "2026-03-02",
        }),
      ],
      "2026-03-01",
      "2026-03-31"
    );

    expect(data[0].net).toBe(-150);
  });

  it("produces no NaN for a single transaction", () => {
    const data = getIncomeExpenseChartData(
      [makeTransaction({ id: "a", projectedAmount: 10, scheduledDate: "2026-03-02" })],
      "2026-03-01",
      "2026-03-31"
    );

    data.forEach((point) => {
      expect(Number.isNaN(point.income)).toBe(false);
      expect(Number.isNaN(point.expenses)).toBe(false);
      expect(Number.isNaN(point.net)).toBe(false);
    });
  });

  describe("known defects", () => {
    /**
     * DEFECT: days with no activity are OMITTED rather than emitted as zeros.
     *
     * A chart fed these points draws a straight line from 2026-03-02 to
     * 2026-03-20, implying steady activity across the gap. There is no way for
     * the consumer to distinguish "no transactions" from "not in the data",
     * and because the x-axis is categorical in Recharts the two points render
     * adjacent — an 18-day gap looks like one day.
     *
     * CORRECT: every bucket in the requested range should be present, with
     * zeros where nothing happened.
     */
    it.fails("KNOWN DEFECT: emits empty buckets as zeros instead of omitting them", () => {
      const data = getIncomeExpenseChartData(
        [
          makeTransaction({ id: "a", projectedAmount: 10, scheduledDate: "2026-03-02" }),
          makeTransaction({ id: "b", projectedAmount: 20, scheduledDate: "2026-03-05" }),
        ],
        "2026-03-01",
        "2026-03-07"
      );

      // Seven days requested, so seven points.
      expect(data.map((point) => point.date)).toEqual([
        "2026-03-01",
        "2026-03-02",
        "2026-03-03",
        "2026-03-04",
        "2026-03-05",
        "2026-03-06",
        "2026-03-07",
      ]);
    });
  });
});
