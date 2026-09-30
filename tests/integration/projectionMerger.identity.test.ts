import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/types";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import {
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  makeManualTransaction,
  makeSkippedTransaction,
} from "../helpers/builders";
import { duplicates } from "../helpers/dates";

/**
 * R2: the merge is defensive about identity.
 *  - a projection is matched by at most ONE stored row, and a stored row replaces at most ONE projection;
 *  - EVERY stored row that is not consumed is emitted (nothing collapses);
 *  - rows written under an older id scheme (derived from the weekend-adjusted date) still find
 *    their own occurrence;
 *  - a row with no occurrenceId at all matches on sourceId + scheduledDate.
 * "Recalculate Balance" reads exactly this merged list, so dropping or duplicating a row here is
 * a wrong balance (UI-BAL-06/07/08).
 */

const ids = (list: Transaction[]) => list.map((t) => t.id);
const row = (list: Transaction[]) => list.map((t) => `${t.scheduledDate}:${t.status}:${t.id}`);

const stored = (overrides: Partial<Transaction>): Transaction =>
  makeCompletedTransaction({ sourceType: "expense_rule", sourceId: "exp-1", ...overrides });

const monthly = (extra = {}) =>
  makeExpenseRule({ id: "exp-1", frequency: "monthly", startDate: "2026-01-15", ...extra });

const merge = (
  storedRows: Transaction[],
  rules: ReturnType<typeof monthly>[],
  start: string,
  end: string
) => mergeTransactionsWithProjections(storedRows, [], rules, { start, end }, "u");

describe("merge: every stored row is emitted exactly once", () => {
  it("never drops or duplicates a stored row, whatever mix of matching and non-matching rows it gets", () => {
    const rule = monthly();
    const inactive = makeExpenseRule({
      id: "gone",
      isActive: false,
      frequency: "monthly",
      startDate: "2026-01-01",
    });
    const storedRows = [
      stored({ id: "match-jan", occurrenceId: "exp-1_2026-01", scheduledDate: "2026-01-15" }),
      stored({ id: "match-feb-moved", occurrenceId: "exp-1_2026-02", scheduledDate: "2026-02-20" }), // rescheduled
      stored({ id: "dup-feb-a", occurrenceId: "exp-1_2026-02", scheduledDate: "2026-02-15" }), // same id again
      stored({ id: "dup-feb-b", occurrenceId: "exp-1_2026-02", scheduledDate: "2026-02-15" }), // and again
      stored({ id: "legacy-mar", occurrenceId: undefined, scheduledDate: "2026-03-15" }), // no occurrenceId
      stored({ id: "legacy-mar-2", occurrenceId: undefined, scheduledDate: "2026-03-15" }), // a second one
      stored({
        id: "other-source",
        sourceId: "gone",
        occurrenceId: "gone_2026-01",
        scheduledDate: "2026-01-01",
      }),
      stored({ id: "outside-window", occurrenceId: "exp-1_2025-06", scheduledDate: "2025-06-15" }),
      makeSkippedTransaction({
        id: "skipped-apr",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-04",
        scheduledDate: "2026-04-15",
      }),
      makeManualTransaction({ id: "manual-1", scheduledDate: "2026-02-02" }),
      makeManualTransaction({ id: "manual-2", scheduledDate: "2026-02-02" }),
    ];

    const merged = mergeTransactionsWithProjections(
      storedRows,
      [],
      [rule, inactive],
      { start: "2026-01-01", end: "2026-05-31" },
      "u"
    );

    // Every stored id appears exactly once...
    for (const t of storedRows) {
      expect(
        ids(merged).filter((id) => id === t.id),
        `stored row ${t.id}`
      ).toHaveLength(1);
    }
    // ...all output ids are pairwise distinct...
    expect(duplicates(ids(merged))).toEqual([]);
    // ...and the only projection left is May (Jan/Feb/Mar/Apr were all claimed by a stored row).
    expect(ids(merged).filter((id) => id.startsWith("proj_"))).toEqual([
      "proj_exp-1::2026-05-15::exp-1_2026-05",
    ]);
    // 11 stored + 1 projection.
    expect(merged).toHaveLength(12);
  });

  it("lets one stored row replace one projection only: a surplus row with the same id stays a separate row", () => {
    const merged = merge(
      [
        stored({
          id: "part-1",
          occurrenceId: "exp-1_2026-01",
          scheduledDate: "2026-01-15",
          actualAmount: 600,
        }),
        stored({
          id: "part-2",
          occurrenceId: "exp-1_2026-01",
          scheduledDate: "2026-01-15",
          actualAmount: 600,
        }),
        stored({
          id: "part-3",
          occurrenceId: "exp-1_2026-01",
          scheduledDate: "2026-01-15",
          actualAmount: 600,
        }),
      ],
      [monthly()],
      "2026-01-01",
      "2026-01-31"
    );
    expect(ids(merged)).toEqual(["part-1", "part-2", "part-3"]);
    // Money check: three realised payments of 600 are all present (the sum a balance recomputation sees).
    expect(merged.reduce((sum, t) => sum + (t.actualAmount ?? 0), 0)).toBe(1_800);
  });

  it("prefers the row on the projection's own date when several share the id", () => {
    const merged = merge(
      [
        stored({ id: "elsewhere", occurrenceId: "exp-1_2026-01", scheduledDate: "2026-01-05" }),
        stored({ id: "on-date", occurrenceId: "exp-1_2026-01", scheduledDate: "2026-01-15" }),
      ],
      [monthly()],
      "2026-01-01",
      "2026-01-31"
    );
    // Both are emitted; "on-date" consumed the projection (no proj_ row remains either way).
    expect(ids(merged).sort()).toEqual(["elsewhere", "on-date"]);
  });

  it("emits rows of inactive or deleted sources and rows outside the window untouched", () => {
    const orphan = stored({
      id: "orphan",
      sourceId: "deleted-rule",
      occurrenceId: "deleted-rule_2026-01",
      scheduledDate: "2026-01-15",
    });
    const merged = merge([orphan], [monthly()], "2026-03-01", "2026-03-31");
    expect(ids(merged)).toContain("orphan");
    expect(ids(merged)).toContain("proj_exp-1::2026-03-15::exp-1_2026-03");
  });
});

describe("merge: rows written before identity moved to the logical date", () => {
  // Old engine: the id was derived from the weekend-ADJUSTED date. Semi-monthly [15, 30] "after",
  // March 2026: Sun 15 -> Mon 16, Mon 30 stays. Both got `semi_2026-03-2`. Today: slot 1 and slot 2.
  const semi = makeIncomeSource({
    id: "semi",
    frequency: "semi-monthly",
    startDate: "2026-03-01",
    scheduleConfig: { specificDays: [15, 30] },
    weekendAdjustment: "after",
  });
  const mergeIncome = (rows: Transaction[]) =>
    mergeTransactionsWithProjections(
      rows,
      [semi],
      [],
      { start: "2026-03-01", end: "2026-03-31" },
      "u"
    );
  const paid = (overrides: Partial<Transaction>) =>
    makeCompletedTransaction({
      type: "income",
      sourceType: "income_source",
      sourceId: "semi",
      ...overrides,
    });

  it("a row stored for the 15th payday under the old id claims the 15th's projection, not the 30th's", () => {
    // Old id `semi_2026-03-2` with scheduledDate 3/16 (the adjusted date of the 15th).
    const merged = mergeIncome([
      paid({ id: "paid-15th", occurrenceId: "semi_2026-03-2", scheduledDate: "2026-03-16" }),
    ]);
    expect(row(merged)).toEqual([
      "2026-03-16:completed:paid-15th",
      "2026-03-30:projected:proj_semi::2026-03-30::semi_2026-03-2",
    ]);
  });

  it("a row stored for the 30th payday under the same old id claims the 30th's projection", () => {
    const merged = mergeIncome([
      paid({ id: "paid-30th", occurrenceId: "semi_2026-03-2", scheduledDate: "2026-03-30" }),
    ]);
    expect(row(merged)).toEqual([
      "2026-03-16:projected:proj_semi::2026-03-16::semi_2026-03-1",
      "2026-03-30:completed:paid-30th",
    ]);
  });

  it("both paydays stored under the same old id each claim their own projection (neither is dropped)", () => {
    const merged = mergeIncome([
      paid({ id: "paid-15th", occurrenceId: "semi_2026-03-2", scheduledDate: "2026-03-16" }),
      paid({ id: "paid-30th", occurrenceId: "semi_2026-03-2", scheduledDate: "2026-03-30" }),
    ]);
    expect(row(merged)).toEqual([
      "2026-03-16:completed:paid-15th",
      "2026-03-30:completed:paid-30th",
    ]);
  });

  it("E2E-CAL-11: a row for August's payday (Sat Aug 1 'before' -> Fri Jul 31) stored under July's id does not claim July 1", () => {
    // Old engine labelled Jul 31 `m1_2026-07`, colliding with Jul 1. The row carries scheduledDate 7/31.
    const m1 = makeIncomeSource({
      id: "m1",
      frequency: "monthly",
      startDate: "2026-06-01",
      scheduleConfig: { dayOfMonth: 1 },
      weekendAdjustment: "before",
    });
    const merged = mergeTransactionsWithProjections(
      [
        makeCompletedTransaction({
          id: "paid-aug",
          type: "income",
          sourceType: "income_source",
          sourceId: "m1",
          occurrenceId: "m1_2026-07",
          scheduledDate: "2026-07-31",
        }),
      ],
      [m1],
      [],
      { start: "2026-06-01", end: "2026-08-31" },
      "u"
    );
    expect(row(merged)).toEqual([
      "2026-06-01:projected:proj_m1::2026-06-01::m1_2026-06",
      "2026-07-01:projected:proj_m1::2026-07-01::m1_2026-07",
      "2026-07-31:completed:paid-aug",
    ]);
  });
});

describe("merge: rows with no occurrenceId (UI-LIFE-30)", () => {
  it("replaces the projection on its sourceId + scheduledDate", () => {
    const merged = merge(
      [stored({ id: "legacy", occurrenceId: undefined, scheduledDate: "2026-01-15" })],
      [monthly()],
      "2026-01-01",
      "2026-02-28"
    );
    expect(ids(merged)).toEqual(["legacy", "proj_exp-1::2026-02-15::exp-1_2026-02"]);
  });

  it("does not match a projection of a different source on the same date", () => {
    const other = makeExpenseRule({ id: "exp-2", frequency: "monthly", startDate: "2026-01-15" });
    const merged = merge(
      [
        stored({
          id: "legacy",
          sourceId: "exp-2",
          occurrenceId: undefined,
          scheduledDate: "2026-01-15",
        }),
      ],
      [monthly(), other],
      "2026-01-01",
      "2026-01-31"
    );
    // exp-2's legacy row replaces exp-2's projection only; exp-1's projection is untouched.
    expect(ids(merged).sort()).toEqual(["legacy", "proj_exp-1::2026-01-15::exp-1_2026-01"]);
  });
});
