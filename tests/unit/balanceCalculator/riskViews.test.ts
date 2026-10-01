import { describe, expect, it } from "vitest";

import type { Transaction } from "@/lib/types";
import { getBillCoverageReport, BILL_COVERAGE_DAYS } from "@/lib/logic/balanceCalculator/billCoverage";
import { getNextCrunch, getRunway, RISK_HORIZON_DAYS, walkRisk } from "@/lib/logic/balanceCalculator/runway";
import { calculateRunwayScore } from "@/lib/logic/healthScore/scoreCalculators";
import {
  makeCompletedTransaction,
  makeManualTransaction,
  makeProjectedTransaction,
} from "../../helpers/builders";

/**
 * THEME: runway, next crunch, health runway and bill coverage are readings of ONE model (D5):
 * the realized balance, the overdue expenses folded into day 0, then every projected row day by day
 * with income credited before expenses. All figures hand-derived; `today` is explicit.
 */

const TODAY = "2026-03-16";
const row = (overrides: Partial<Transaction>) =>
  makeProjectedTransaction({ sourceId: "r", ...overrides });

describe("runway, crunch and health runway agree on the first negative day", () => {
  // each scenario: [description, balance, rows, expected first-negative day offset (null = none)]
  const scenarios: Array<[string, number, Transaction[], number | null]> = [
    ["a bill that overdraws on day 3", 1_000, [row({ id: "a", scheduledDate: "2026-03-19", projectedAmount: 1_200 })], 3],
    ["a payday that arrives the same day as the bill", 100, [
      row({ id: "bill", scheduledDate: "2026-03-18", projectedAmount: 500 }),
      row({ id: "pay", type: "income", scheduledDate: "2026-03-18", projectedAmount: 1_000 }),
    ], null],
    ["an overdue bill larger than the balance", 300, [row({ id: "o", scheduledDate: "2026-03-10", projectedAmount: 400 })], 0],
    ["an account that is already overdrawn", -50, [], 0],
    ["a completed row is never walked", 1_000, [makeCompletedTransaction({ scheduledDate: "2026-03-17", projectedAmount: 5_000 })], null],
    ["a bill beyond the horizon", 1_000, [row({ id: "far", scheduledDate: "2026-07-14", projectedAmount: 5_000 })], null],
  ];

  scenarios.forEach(([description, balance, rows, offset]) => {
    it(`${description}: runway, crunch and score read the same walk`, () => {
      const runway = getRunway(balance, rows, RISK_HORIZON_DAYS, TODAY);
      const crunch = getNextCrunch(balance, rows, RISK_HORIZON_DAYS, TODAY);
      const score = calculateRunwayScore(balance, rows, TODAY);

      if (offset === null) {
        expect(runway).toEqual({ days: RISK_HORIZON_DAYS, runOutDate: null });
        expect(crunch).toBeNull();
        expect(score.daysRemaining).toBe(RISK_HORIZON_DAYS);
      } else {
        expect(runway.days).toBe(offset);
        expect(score.daysRemaining).toBe(offset);
        expect(crunch?.date).toBe(runway.runOutDate);
      }
    });
  });

  it("the horizon is 90 days: a bill on day 89 is seen, one on day 90 is not", () => {
    // today 03-16 + 89 = 06-13 ; + 90 = 06-14
    const seen = [row({ id: "d89", scheduledDate: "2026-06-13", projectedAmount: 5_000 })];
    const beyond = [row({ id: "d90", scheduledDate: "2026-06-14", projectedAmount: 5_000 })];

    expect(getRunway(1_000, seen, RISK_HORIZON_DAYS, TODAY).days).toBe(89);
    expect(getRunway(1_000, beyond, RISK_HORIZON_DAYS, TODAY)).toEqual({ days: 90, runOutDate: null });
  });
});

describe("walkRisk", () => {
  it("reports the overdue amount folded into day 0 and the lowest balance reached", () => {
    // B = 1,000; overdue expense 300 (03-10); a 200 bill on 03-18 and a 900 payday on 03-20
    const walk = walkRisk(
      1_000,
      [
        row({ id: "o", scheduledDate: "2026-03-10", projectedAmount: 300 }),
        row({ id: "b", scheduledDate: "2026-03-18", projectedAmount: 200 }),
        row({ id: "p", type: "income", scheduledDate: "2026-03-20", projectedAmount: 900 }),
      ],
      RISK_HORIZON_DAYS,
      TODAY
    );

    expect(walk.overdueOutflow).toBe(300);
    expect(walk.lowestBalance).toBe(500); // 1,000 - 300 - 200 before the payday
    expect(walk.firstNegative).toBeNull();
    expect(walk.alreadyOverdrawn).toBe(false);
  });

  it("an overdrawn account is reported today with the deeper of 'now' and 'end of today'", () => {
    const walk = walkRisk(-500, [row({ id: "b", scheduledDate: TODAY, projectedAmount: 200 })], 30, TODAY);

    expect(walk.alreadyOverdrawn).toBe(true);
    expect(walk.firstNegative).toEqual({ index: 0, date: TODAY, balance: -700 });
  });
});

describe("bill coverage", () => {
  const bill = (id: string, date: string, amount: number, extra: Partial<Transaction> = {}) =>
    row({ id, name: id, scheduledDate: date, projectedAmount: amount, ...extra });

  it("the window is exactly 14 days by default (today .. today + 13)", () => {
    expect(BILL_COVERAGE_DAYS).toBe(14);
    const report = getBillCoverageReport(
      10_000,
      [
        bill("d0", "2026-03-16", 10),
        bill("d13", "2026-03-29", 10),
        bill("d14", "2026-03-30", 10),
      ],
      undefined,
      TODAY
    );

    expect(report.upcomingBills.map((b) => b.transaction.id)).toEqual(["d0", "d13"]);
    expect(report.projectedBalance).toBe(9_980);
  });

  it("each shortfall is the bill's own uncovered part; the balance still runs on", () => {
    // balance 150: A 100 covered (50 left), B 200 needs 150 (only 50 available), C 80 needs all 80.
    const report = getBillCoverageReport(
      150,
      [bill("A", "2026-03-17", 100), bill("B", "2026-03-18", 200), bill("C", "2026-03-19", 80)],
      14,
      TODAY
    );

    expect(report.upcomingBills.map((b) => [b.transaction.id, b.canCover, b.shortfall])).toEqual([
      ["A", true, undefined],
      ["B", false, 150],
      ["C", false, 80],
    ]);
    expect(report.projectedBalance).toBe(-230); // 150 - 100 - 200 - 80
    expect(report.firstShortfall).toEqual({ date: "2026-03-18", amount: 150, billName: "B" });
  });

  it("is independent of the order the rows arrive in (income before bills, then name)", () => {
    // balance 100; bill 150 and a 200 payday on the same day: the payday is credited first
    const rows = [
      bill("Rent", "2026-03-20", 150),
      makeManualTransaction({ id: "pay", name: "Payday", type: "income", scheduledDate: "2026-03-20", projectedAmount: 200 }),
    ];
    const forward = getBillCoverageReport(100, rows, 14, TODAY);
    const backward = getBillCoverageReport(100, [...rows].reverse(), 14, TODAY);

    expect(forward).toEqual(backward);
    expect(forward.upcomingBills[0].canCover).toBe(true);
    expect(forward.projectedBalance).toBe(150);
  });

  it("lists an OVERDUE bill first (daysUntilDue < 0); an overdue income is not credited", () => {
    // balance 500: overdue Rent 400 (03-10), overdue Refund +900 (03-12) never arrived, Gym 300 on 03-20
    const report = getBillCoverageReport(
      500,
      [
        bill("Rent", "2026-03-10", 400),
        row({ id: "Refund", name: "Refund", type: "income", scheduledDate: "2026-03-12", projectedAmount: 900 }),
        bill("Gym", "2026-03-20", 300),
      ],
      14,
      TODAY
    );

    expect(report.upcomingBills.map((b) => [b.transaction.id, b.daysUntilDue, b.canCover, b.shortfall])).toEqual([
      ["Rent", -6, true, undefined],
      ["Gym", 4, false, 200], // 500 - 400 = 100 left, Gym 300 needs 200
    ]);
    expect(report.totalUpcoming).toBe(700);
    expect(report.projectedBalance).toBe(-200);
  });

  it("an overdue bill outside the default window (older than two months back) is not tracked", () => {
    const report = getBillCoverageReport(1_000, [bill("ancient", "2025-12-01", 900)], 14, TODAY);

    expect(report.upcomingBills).toEqual([]);
  });
});
