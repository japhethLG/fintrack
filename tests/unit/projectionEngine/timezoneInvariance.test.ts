import { afterEach, describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/types";
import { generateProjections } from "@/lib/logic/projectionEngine/projectionGenerator";
import { calculateOccurrencesDetailed } from "@/lib/logic/projectionEngine/occurrenceCalculator";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import { calculateForecast } from "@/lib/logic/forecasting/forecastCalculator";
import { getBestBucketType, getIncomeExpenseChartData } from "@/lib/logic/healthScore/chartData";
import { getDaysBetween } from "@/lib/logic/balanceCalculator/utils";
import { formatDate, parseDate } from "@/lib/utils/dateUtils";
import {
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  makeProjectedTransaction,
} from "../../helpers/builders";

/**
 * R4 invariant: for FIXED STRING inputs, the engine's output is identical in every time zone.
 * A calendar day is a local "YYYY-MM-DD" string; nothing may depend on the UTC offset, on DST, or
 * on the wall-clock time a Date happens to carry.
 *
 * The zones cover both UTC signs, a zone 14 hours ahead, and the two zones whose spring-forward
 * happens AT MIDNIGHT (America/Santiago, Asia/Beirut), where `new Date(y, m, d)` is 01:00 and
 * stepping a cursor by wall-clock loses or repeats a day. The vitest process is switched between
 * zones by assigning `process.env.TZ` (Node re-reads it immediately) and restored afterwards.
 */

const ZONES = [
  "UTC",
  "Asia/Manila",
  "America/New_York",
  "America/Los_Angeles",
  "America/Santiago",
  "Asia/Beirut",
  "Pacific/Auckland",
  "Pacific/Kiritimati",
];

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/** Run `fn` in each zone and return the JSON of its result, keyed by zone. */
const inEveryZone = (fn: () => unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const zone of ZONES) {
    process.env.TZ = zone;
    out[zone] = JSON.stringify(fn());
  }
  return out;
};

/** Assert every zone produced the UTC result. Reports the first differing zone. */
const expectSameEverywhere = (results: Record<string, string>) => {
  const baseline = results.UTC;
  expect(baseline).toBeDefined();
  for (const zone of ZONES) {
    expect(results[zone], `zone ${zone} differs from UTC`).toBe(baseline);
  }
  return JSON.parse(baseline);
};

describe("time-zone invariance (fixed string inputs)", () => {
  it("harness precondition: assigning process.env.TZ really switches the zone", () => {
    const offsets = inEveryZone(() => new Date(2026, 0, 15, 12).getTimezoneOffset());
    // getTimezoneOffset is minutes BEHIND UTC: Manila UTC+8 = -480, New York (EST) = 300, Kiritimati UTC+14 = -840.
    expect(JSON.parse(offsets.UTC)).toBe(0);
    expect(JSON.parse(offsets["Asia/Manila"])).toBe(-480);
    expect(JSON.parse(offsets["America/New_York"])).toBe(300);
    expect(JSON.parse(offsets["Pacific/Kiritimati"])).toBe(-840);
    // Santiago is in DST (UTC-3) in January, Beirut is on winter time (UTC+2).
    expect(JSON.parse(offsets["America/Santiago"])).toBe(180);
    expect(JSON.parse(offsets["Asia/Beirut"])).toBe(-120);
  });

  it("projections for every frequency, with and without weekend adjustment, are identical in every zone", () => {
    const sources = (["none", "before", "after"] as const).flatMap((adj) => [
      makeIncomeSource({
        id: `w-${adj}`,
        frequency: "weekly",
        startDate: "2026-01-03",
        scheduleConfig: { dayOfWeek: 6 },
        weekendAdjustment: adj,
      }),
      makeIncomeSource({
        id: `bw-${adj}`,
        frequency: "bi-weekly",
        startDate: "2025-03-01",
        weekendAdjustment: adj,
      }),
      makeIncomeSource({
        id: `semi-${adj}`,
        frequency: "semi-monthly",
        startDate: "2026-01-01",
        scheduleConfig: { specificDays: [15, 30] },
        weekendAdjustment: adj,
      }),
      makeIncomeSource({
        id: `m-${adj}`,
        frequency: "monthly",
        startDate: "2026-01-31",
        scheduleConfig: { dayOfMonth: 31 },
        weekendAdjustment: adj,
      }),
      makeIncomeSource({
        id: `q-${adj}`,
        frequency: "quarterly",
        startDate: "2026-01-01",
        weekendAdjustment: adj,
      }),
      makeIncomeSource({
        id: `y-${adj}`,
        frequency: "yearly",
        startDate: "2026-01-01",
        scheduleConfig: { monthOfYear: 0 },
        weekendAdjustment: adj,
      }),
    ]);
    const rules = [
      makeExpenseRule({
        id: "daily",
        frequency: "daily",
        startDate: "2026-08-20",
        weekendAdjustment: "after",
      }),
      makeExpenseRule({ id: "once", frequency: "one-time", startDate: "2026-09-06" }),
    ];

    const results = inEveryZone(() =>
      generateProjections(sources, rules, parseDate("2025-11-01"), parseDate("2026-09-30")).map(
        (p) => [p.sourceId, p.scheduledDate, p.occurrenceId]
      )
    );
    const rows = expectSameEverywhere(results);
    expect(rows.length).toBeGreaterThan(100);
  });

  it("bi-weekly ids count whole calendar days, so a DST change cannot repeat or skip an index", () => {
    // Verified defect: in America/New_York, 2025-03-01 and 2025-03-15 both got `sal_BW1` because the
    // id divided millisecond deltas across the Mar 9 spring-forward. By whole days, the anchor
    // 2025-03-01 gives floor(0/14)+1 = 1, floor(14/14)+1 = 2, floor(28/14)+1 = 3 ... in EVERY zone.
    const anchor = "2025-03-01";
    const days = [
      "2025-03-01",
      "2025-03-15",
      "2025-03-29",
      "2025-04-12",
      "2025-10-25",
      "2025-11-08",
      "2025-11-22",
    ];
    const results = inEveryZone(() =>
      days.map((day) => generateOccurrenceId("sal", "bi-weekly", parseDate(day), anchor, {}))
    );
    // Hand-derived day offsets from 2025-03-01: 0, 14, 28, 42, 238, 252, 266 -> /14 -> 0,1,2,3,17,18,19.
    expect(expectSameEverywhere(results)).toEqual([
      "sal_BW1",
      "sal_BW2",
      "sal_BW3",
      "sal_BW4",
      "sal_BW18",
      "sal_BW19",
      "sal_BW20",
    ]);
  });

  it("merging stored rows with projections is identical in every zone, including each window boundary day", () => {
    const rule = makeExpenseRule({
      id: "exp-1",
      frequency: "monthly",
      startDate: "2026-01-01",
      scheduleConfig: { dayOfMonth: 1 },
    });
    const stored: Transaction[] = [
      makeCompletedTransaction({
        id: "done",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-03",
        scheduledDate: "2026-03-01",
      }),
    ];
    const results = inEveryZone(() =>
      mergeTransactionsWithProjections(
        stored,
        [],
        [rule],
        { start: "2026-03-01", end: "2026-06-01" },
        "u"
      ).map((t) => [t.id, t.scheduledDate, t.status])
    );
    // The window is INCLUSIVE at both ends: Mar 1 (stored, completed), Apr 1, May 1, Jun 1.
    expect(expectSameEverywhere(results)).toEqual([
      ["done", "2026-03-01", "completed"],
      ["proj_exp-1::2026-04-01::exp-1_2026-04", "2026-04-01", "projected"],
      ["proj_exp-1::2026-05-01::exp-1_2026-05", "2026-05-01", "projected"],
      ["proj_exp-1::2026-06-01::exp-1_2026-06", "2026-06-01", "projected"],
    ]);
  });

  it("a window's first and last day are both inside it in every zone (month-end payday is not dropped)", () => {
    // E2E-CAL-13: in New York the window's last day vanished; in Manila its first day did.
    const occ = (frequency: "monthly" | "one-time", start: string) =>
      calculateOccurrencesDetailed(
        { frequency, startDate: start, scheduleConfig: {}, weekendAdjustment: "none" },
        parseDate("2026-06-01"),
        parseDate("2026-08-31")
      ).map((o) => formatDate(o.date));
    const results = inEveryZone(() => [
      occ("monthly", "2026-05-31"),
      occ("one-time", "2026-06-01"),
      occ("one-time", "2026-08-31"),
    ]);
    // Monthly on the 31st clamps: Jun 30, Jul 31, Aug 31 (May 31 is before the window).
    expect(expectSameEverywhere(results)).toEqual([
      ["2026-06-30", "2026-07-31", "2026-08-31"],
      ["2026-06-01"],
      ["2026-08-31"],
    ]);
  });

  it("getDaysBetween yields one entry per calendar day across a midnight spring-forward", () => {
    // Santiago springs forward at 00:00 on Sat 2026-09-05 -> Sun 09-06 (wall clock skips midnight),
    // Beirut on Sun 2026-03-29. Stepping a wall-clock cursor lost the range's final day there.
    const ranges: [string, string][] = [
      ["2026-09-03", "2026-09-09"],
      ["2026-03-26", "2026-04-01"],
      ["2026-03-07", "2026-03-10"],
    ];
    const results = inEveryZone(() =>
      ranges.map(([a, b]) =>
        getDaysBetween(parseDate(a), parseDate(b)).map((day) => formatDate(day))
      )
    );
    expect(expectSameEverywhere(results)).toEqual([
      [
        "2026-09-03",
        "2026-09-04",
        "2026-09-05",
        "2026-09-06",
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
      ],
      [
        "2026-03-26",
        "2026-03-27",
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
        "2026-03-31",
        "2026-04-01",
      ],
      ["2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"],
    ]);
  });

  it("calculateForecast labels and balances are identical in every zone", () => {
    const txns = [
      makeProjectedTransaction({
        id: "a",
        scheduledDate: "2026-03-15",
        type: "expense",
        projectedAmount: 500,
      }),
      makeProjectedTransaction({
        id: "b",
        scheduledDate: "2026-03-17",
        type: "income",
        projectedAmount: 200,
      }),
      makeProjectedTransaction({
        id: "old",
        scheduledDate: "2026-03-14",
        type: "expense",
        projectedAmount: 999,
      }),
    ];
    const results = inEveryZone(() =>
      calculateForecast(10_000, txns, parseDate("2026-03-15"), 5).map((p) => [p.date, p.balance])
    );
    expect(expectSameEverywhere(results)).toEqual([
      ["2026-03-15", 9_500],
      ["2026-03-16", 9_500],
      ["2026-03-17", 9_700],
      ["2026-03-18", 9_700],
      ["2026-03-19", 9_700],
    ]);
  });

  it("chart buckets, labels and the bucket recommendation are identical in every zone", () => {
    const txns = [
      makeProjectedTransaction({
        id: "a",
        scheduledDate: "2026-03-01",
        type: "income",
        projectedAmount: 100,
      }),
      makeProjectedTransaction({
        id: "b",
        scheduledDate: "2026-03-31",
        type: "expense",
        projectedAmount: 40,
      }),
      makeProjectedTransaction({
        id: "c",
        scheduledDate: "2026-04-15",
        type: "expense",
        projectedAmount: 10,
      }),
    ];
    const results = inEveryZone(() => ({
      monthly: getIncomeExpenseChartData(txns, "2026-03-01", "2026-04-30", "monthly").map((p) => [
        p.date,
        p.label,
        p.income,
        p.expenses,
      ]),
      daily: getIncomeExpenseChartData(txns, "2026-03-01", "2026-04-30", "daily").map((p) => [
        p.date,
        p.label,
        p.income,
        p.expenses,
      ]),
      bucket: [
        getBestBucketType("2026-03-01", "2026-03-15"),
        getBestBucketType("2026-03-01", "2026-03-16"),
        getBestBucketType("2026-03-01", "2026-06-01"),
      ],
    }));
    const out = expectSameEverywhere(results);
    expect(out.monthly).toEqual([
      ["2026-03", "Mar 2026", 100, 40],
      ["2026-04", "Apr 2026", 0, 10],
    ]);
    // Zero-filled: every day of 2026-03-01 .. 2026-04-30 (31 + 30 = 61 buckets), in every zone.
    expect(out.daily).toHaveLength(61);
    expect(out.daily[0][0]).toBe("2026-03-01");
    expect(out.daily[60][0]).toBe("2026-04-30");
    const withActivity = out.daily.filter((p: (string | number)[]) => p[2] !== 0 || p[3] !== 0);
    expect(withActivity.map((p: (string | number)[]) => p[0])).toEqual([
      "2026-03-01",
      "2026-03-31",
      "2026-04-15",
    ]);
    expect(withActivity.map((p: (string | number)[]) => p[1])).toEqual([
      "Mar 1",
      "Mar 31",
      "Apr 15",
    ]);
    // 14 days apart -> daily; 15 days -> weekly; 92 days -> monthly.
    expect(out.bucket).toEqual(["daily", "weekly", "monthly"]);
  });
});
