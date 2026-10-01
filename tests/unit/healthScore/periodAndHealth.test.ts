import { describe, expect, it } from "vitest";

import { calculateHealthScore } from "@/lib/logic/healthScore/healthScoreCalculator";
import {
  percentChange,
  savingsRatePercent,
  summarizePeriod,
} from "@/lib/logic/healthScore/periodStats";
import { sampleDayOffsets } from "@/lib/logic/healthScore/chartData";
import {
  calculateBalanceTrendScore,
  calculateSavingsRateScore,
} from "@/lib/logic/healthScore/scoreCalculators";
import { calculateProjectedVsActual } from "@/lib/logic/balanceCalculator/variance";
import type { DayBalance } from "@/lib/types";
import {
  makeCompletedTransaction,
  makeProjectedTransaction,
  makeSkippedTransaction,
} from "../../helpers/builders";

/** Every expected value is derived by hand next to the assertion. */

describe("summarizePeriod: the one definition of a period's income, expenses and net", () => {
  const rows = [
    makeCompletedTransaction({ id: "pay", type: "income", projectedAmount: 2_000, actualAmount: 1_950, scheduledDate: "2026-03-15" }),
    makeProjectedTransaction({ id: "pay2", type: "income", projectedAmount: 2_000, scheduledDate: "2026-03-30" }),
    makeCompletedTransaction({ id: "waived", type: "expense", projectedAmount: 100, actualAmount: 0, scheduledDate: "2026-03-05" }),
    makeProjectedTransaction({ id: "bill", type: "expense", projectedAmount: 250, scheduledDate: "2026-03-20" }),
    makeSkippedTransaction({ id: "skip", type: "expense", projectedAmount: 999, scheduledDate: "2026-03-21" }),
    makeProjectedTransaction({ id: "out", type: "expense", projectedAmount: 77, scheduledDate: "2026-04-01" }),
  ];

  it("counts a completed row at its actual (0 is real), a pending row at its plan, skipped rows nowhere", () => {
    const s = summarizePeriod(rows, "2026-03-01", "2026-03-31");

    // income: 1,950 (actual) + 2,000 (plan) = 3,950 ; expenses: 0 (waived) + 250 = 250 ; net 3,700
    expect(s.income).toBe(3_950);
    expect(s.expenses).toBe(250);
    expect(s.net).toBe(3_700);
    expect(s.completedIncomeCount).toBe(1);
    expect(s.pendingIncomeCount).toBe(1);
    expect(s.completedExpenseCount).toBe(1);
    expect(s.pendingExpenseCount).toBe(1);
    expect(s.skippedCount).toBe(1);
    expect(s.transactionCount).toBe(5); // the April row is outside
  });

  it("files a row under actualDate when it has one", () => {
    const late = makeCompletedTransaction({
      id: "late",
      type: "expense",
      projectedAmount: 100,
      actualAmount: 130,
      scheduledDate: "2026-02-27",
      actualDate: "2026-03-02",
    });

    expect(summarizePeriod([late], "2026-03-01", "2026-03-31").expenses).toBe(130);
    expect(summarizePeriod([late], "2026-02-01", "2026-02-28").expenses).toBe(0);
  });
});

describe("savingsRatePercent", () => {
  it("is (income - expenses) / income, and -100 when something is spent with no income at all", () => {
    expect(savingsRatePercent(1_000, 750)).toBe(25); // 250 / 1,000
    expect(savingsRatePercent(1_000, 1_500)).toBe(-50); // -500 / 1,000
    expect(savingsRatePercent(0, 3_000)).toBe(-100);
    expect(savingsRatePercent(0, 0)).toBe(0);
  });

  it("scores spending with no income 0 and reports a negative rate (UI-DISP-31/35)", () => {
    const result = calculateSavingsRateScore(
      [makeProjectedTransaction({ type: "expense", projectedAmount: 3_000, scheduledDate: "2026-03-20" })],
      "2026-03-01",
      "2026-03-31"
    );

    expect(result).toEqual({ score: 0, rate: -100 });
  });
});

describe("percentChange measures against |previous|", () => {
  it("a worsening negative value is a drop, an improving one is a rise (UI-DISP-19)", () => {
    expect(percentChange(-1_500, -1_000)).toBe(-50); // (-1,500 + 1,000) / 1,000
    expect(percentChange(-500, -1_000)).toBe(50); // (-500 + 1,000) / 1,000
    expect(percentChange(500, -1_000)).toBe(150); // out of the red: (500 + 1,000) / 1,000
  });

  it("is plain for positive values", () => {
    expect(percentChange(1_100, 200)).toBe(450);
    expect(percentChange(50, 100)).toBe(-50);
  });

  it("has no number when there is no baseline (UI-DISP-20)", () => {
    expect(percentChange(500, 0)).toBeNull();
    expect(percentChange(-400, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });
});

describe("balance trend", () => {
  const days = (entries: Array<[string, number]>): Map<string, DayBalance> =>
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

  it("follows the sign of the slope for an overdrawn account (UI-DISP-29/30)", () => {
    // -1,000 -> -1,500 -> -2,000 -> -2,500: falling. Scale = mean |balance| = 1,750.
    // slope = -500/day -> -500 / 1,750 x 100 = -28.57% -> declining, score max(0, 30 - 285.7) = 0
    const falling = calculateBalanceTrendScore(
      days([["2026-03-01", -1_000], ["2026-03-02", -1_500], ["2026-03-03", -2_000], ["2026-03-04", -2_500]]),
      "2026-03-01",
      "2026-03-31"
    );
    expect(falling).toEqual({ score: 0, trend: "declining" });

    // -2,000 -> -1,500 -> -1,000 -> -500: recovering. mean |balance| = 1,250; slope +500/day ->
    // +40% -> improving, score min(100, 70 + 400) = 100
    const recovering = calculateBalanceTrendScore(
      days([["2026-03-01", -2_000], ["2026-03-02", -1_500], ["2026-03-03", -1_000], ["2026-03-04", -500]]),
      "2026-03-01",
      "2026-03-31"
    );
    expect(recovering).toEqual({ score: 100, trend: "improving" });
  });
});

describe("calculateHealthScore on an empty account", () => {
  it("is flagged insufficientData (the UI shows a neutral state), and a filled one is not", () => {
    expect(calculateHealthScore(0, [], new Map(), "2026-03-01", "2026-03-31", "2026-03-16").insufficientData).toBe(true);

    const filled = calculateHealthScore(
      1_000,
      [makeCompletedTransaction({ type: "income", projectedAmount: 10, scheduledDate: "2026-03-05" })],
      new Map(),
      "2026-03-01",
      "2026-03-31",
      "2026-03-16"
    );
    expect(filled.insufficientData).toBe(false);
  });
});

describe("sampleDayOffsets keeps the end of the range", () => {
  it("plots every day of a range up to 90 days", () => {
    expect(sampleDayOffsets(30)).toHaveLength(31);
    expect(sampleDayOffsets(90).slice(-1)).toEqual([90]);
  });

  it("a 100-day range (99 day-steps) sampled every 2 days still ends on day 99", () => {
    // step = ceil(99 / 90) = 2 -> 0, 2, ..., 98, then the end 99 is appended
    const offsets = sampleDayOffsets(99);

    expect(offsets[0]).toBe(0);
    expect(offsets.slice(-2)).toEqual([98, 99]);
    expect(offsets).toHaveLength(51); // 0..98 step 2 = 50 points + the end
  });

  it("does not repeat the end when the step lands on it", () => {
    // 180 day-steps, step = 2: 0, 2, ..., 180 (91 points), no duplicate
    const offsets = sampleDayOffsets(180);

    expect(offsets.slice(-2)).toEqual([178, 180]);
    expect(new Set(offsets).size).toBe(offsets.length);
  });
});

describe("calculateProjectedVsActual: each side is bucketed by the date it is about", () => {
  // Rent planned for Feb 27 (100), paid late on Mar 2 for 130. A waived fee planned Mar 5 (60), paid 0.
  const rows = [
    makeCompletedTransaction({ id: "rent", type: "expense", projectedAmount: 100, actualAmount: 130, scheduledDate: "2026-02-27", actualDate: "2026-03-02" }),
    makeCompletedTransaction({ id: "fee", type: "expense", projectedAmount: 60, actualAmount: 0, scheduledDate: "2026-03-05" }),
    makeProjectedTransaction({ id: "todo", type: "expense", projectedAmount: 40, scheduledDate: "2026-03-20" }),
    makeSkippedTransaction({ id: "skip", type: "expense", projectedAmount: 500, scheduledDate: "2026-03-10" }),
    makeCompletedTransaction({ id: "pay", type: "income", projectedAmount: 3_000, actualAmount: 3_100, scheduledDate: "2026-03-01" }),
  ];

  it("March: the plan is what was scheduled in March, the actual is what was paid in March", () => {
    const march = calculateProjectedVsActual(rows, "2026-03-01", "2026-03-31");

    // planned expenses: fee 60 + todo 40 = 100 (the rent was FEBRUARY's plan, the skipped row left the plan)
    // actual expenses: rent 130 (paid Mar 2) + fee 0 (a real zero) = 130
    expect(march.expense).toEqual({ projected: 100, actual: 130 });
    expect(march.income).toEqual({ projected: 3_000, actual: 3_100 });
  });

  it("February: the late rent is February's plan and nothing was paid in February", () => {
    const feb = calculateProjectedVsActual(rows, "2026-02-01", "2026-02-28");

    expect(feb.expense).toEqual({ projected: 100, actual: 0 });
    expect(feb.income).toEqual({ projected: 0, actual: 0 });
  });
});
