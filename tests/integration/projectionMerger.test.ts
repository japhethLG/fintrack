import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/types";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import {
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  makeManualTransaction,
  makeSkippedTransaction,
  makeTransaction,
} from "../helpers/builders";
import { daysBetween, duplicates } from "../helpers/dates";

/**
 * Reconciliation layer: generated projections meet stored (realized) rows.
 *
 * Two failure modes matter more than anything else here:
 *   - a stored row that does NOT displace its projection => the money is
 *     counted twice;
 *   - a stored row that is dropped => money that actually happened vanishes.
 * Every assertion below is written so that either mistake turns the suite red.
 */

// ---------------------------------------------------------------------------
// Local assertion helpers.
//
// These are deliberately local rather than added to tests/helpers: they are
// only meaningful for the merger's output shape (a flat Transaction[]).
// ---------------------------------------------------------------------------

const ids = (list: Transaction[]): string[] => list.map((t) => t.id);
const occurrenceIds = (list: Transaction[]): (string | undefined)[] =>
  list.map((t) => t.occurrenceId);
const statuses = (list: Transaction[]): string[] => list.map((t) => t.status);
/** The key the merger claims to sort by: `actualDate || scheduledDate`. */
const sortKeys = (list: Transaction[]): string[] =>
  list.map((t) => t.actualDate || t.scheduledDate);

/** A stored row that came from a rule/source (i.e. has a sourceId). */
const storedForRule = (overrides: Partial<Transaction> = {}): Transaction =>
  makeCompletedTransaction({ sourceType: "expense_rule", sourceId: "exp-1", ...overrides });

const WINDOW_Q1 = { start: "2026-01-01", end: "2026-03-31" };

describe("mergeTransactionsWithProjections", () => {
  // -------------------------------------------------------------------------
  describe("short-circuit when nothing is active", () => {
    it("returns the stored transactions untouched when there are no sources or rules", () => {
      const stored = [
        makeCompletedTransaction({ id: "st-1", scheduledDate: "2026-02-10" }),
        makeManualTransaction({ id: "st-2", scheduledDate: "2026-01-04" }),
      ];

      const merged = mergeTransactionsWithProjections(stored, [], [], WINDOW_Q1, "user-1");

      expect(merged).toEqual(stored);
      // Identity proves the generation/merge/sort pipeline was skipped entirely.
      expect(merged).toBe(stored);
    });

    it("short-circuits when every source and rule is inactive, generating nothing", () => {
      const stored = [storedForRule({ id: "st-1", occurrenceId: "exp-1_2026-01" })];
      // Both of these WOULD produce projections in this window if they were active.
      const inactiveSource = makeIncomeSource({ id: "inc-1", isActive: false });
      const inactiveRule = makeExpenseRule({ id: "exp-1", isActive: false });

      const merged = mergeTransactionsWithProjections(
        stored,
        [inactiveSource],
        [inactiveRule],
        WINDOW_Q1,
        "user-1"
      );

      expect(merged).toBe(stored);
      expect(ids(merged).filter((id) => id.startsWith("proj_"))).toEqual([]);
    });

    it("returns an empty list when nothing is stored and nothing is active", () => {
      expect(mergeTransactionsWithProjections([], [], [], WINDOW_Q1, "user-1")).toEqual([]);
    });

    it("still generates when only one of the two collections has an active entry", () => {
      const activeSource = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const inactiveRule = makeExpenseRule({ id: "exp-1", isActive: false });

      const merged = mergeTransactionsWithProjections(
        [],
        [activeSource],
        [inactiveRule],
        WINDOW_Q1,
        "user-1"
      );

      // Monthly salary on the 1st for Jan/Feb/Mar; the inactive rule contributes nothing.
      expect(sortKeys(merged)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      expect(occurrenceIds(merged).every((o) => o?.startsWith("inc-1_"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("pure projection (nothing stored)", () => {
    it("marks every generated row projected, owned by the caller, with no timestamps", () => {
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

      const merged = mergeTransactionsWithProjections([], [], [rule], WINDOW_Q1, "user-7");

      expect(sortKeys(merged)).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
      expect(statuses(merged)).toEqual(["projected", "projected", "projected"]);
      expect(merged.every((t) => t.id.startsWith("proj_"))).toBe(true);
      expect(merged.map((t) => t.userId)).toEqual(["user-7", "user-7", "user-7"]);
      expect(merged.map((t) => t.createdAt)).toEqual([null, null, null]);
      expect(merged.map((t) => t.updatedAt)).toEqual([null, null, null]);
    });

    it("falls back to an empty userId when no user is signed in", () => {
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

      const merged = mergeTransactionsWithProjections([], [], [rule], WINDOW_Q1, undefined);

      expect(merged.map((t) => t.userId)).toEqual(["", "", ""]);
    });

    it("interleaves income and expense projections in one chronological list", () => {
      const source = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

      const merged = mergeTransactionsWithProjections(
        [],
        [source],
        [rule],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      expect(sortKeys(merged)).toEqual(["2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15"]);
      expect(merged.map((t) => t.type)).toEqual(["income", "expense", "income", "expense"]);
    });

    it("gives every daily occurrence its own row and its own id", () => {
      const rule = makeExpenseRule({
        id: "exp-1",
        frequency: "daily",
        startDate: "2026-01-01",
      });

      const merged = mergeTransactionsWithProjections(
        [],
        [],
        [rule],
        { start: "2026-01-01", end: "2026-01-07" },
        "user-1"
      );

      expect(sortKeys(merged)).toEqual(daysBetween("2026-01-01", "2026-01-07"));
      expect(duplicates(ids(merged))).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("deterministic projection ids", () => {
    it("composes the id as proj_<sourceId>::<scheduledDate>::<occurrenceId>", () => {
      const source = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

      const merged = mergeTransactionsWithProjections(
        [],
        [source],
        [rule],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      // Monthly occurrenceIds are `<sourceId>_<YYYY>-<MM>` (occurrenceIdGenerator.ts:86).
      expect(ids(merged)).toEqual([
        "proj_inc-1::2026-01-01::inc-1_2026-01",
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "proj_inc-1::2026-02-01::inc-1_2026-02",
        "proj_exp-1::2026-02-15::exp-1_2026-02",
      ]);
    });

    it("produces identical ids on repeated calls with identical inputs", () => {
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });
      const window = { start: "2026-01-01", end: "2026-06-30" };

      const first = mergeTransactionsWithProjections([], [], [rule], window, "user-1");
      const second = mergeTransactionsWithProjections([], [], [rule], window, "user-1");

      // Stable across calls is what keeps React keys and drag/drop targets valid.
      expect(ids(second)).toEqual(ids(first));
      expect(ids(first)).toEqual([
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "proj_exp-1::2026-02-15::exp-1_2026-02",
        "proj_exp-1::2026-03-15::exp-1_2026-03",
        "proj_exp-1::2026-04-15::exp-1_2026-04",
        "proj_exp-1::2026-05-15::exp-1_2026-05",
        "proj_exp-1::2026-06-15::exp-1_2026-06",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("stored rows win over their projection", () => {
    const rule = () => makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

    it("replaces the projection with the completed stored row for the same occurrence", () => {
      const stored = storedForRule({
        id: "txn-real-1",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-01-15",
        projectedAmount: 1_200,
        actualAmount: 1_175.5,
      });

      const merged = mergeTransactionsWithProjections([stored], [], [rule()], WINDOW_Q1, "user-1");

      // Jan is realized; Feb and Mar are still projections. Four rows would be a double-count.
      expect(ids(merged)).toEqual([
        "txn-real-1",
        "proj_exp-1::2026-02-15::exp-1_2026-02",
        "proj_exp-1::2026-03-15::exp-1_2026-03",
      ]);
      expect(merged).toHaveLength(3);
      expect(merged[0]).toBe(stored);
      expect(merged[0].actualAmount).toBe(1_175.5);
      expect(merged[0].status).toBe("completed");
    });

    it("replaces the projection with a skipped stored row", () => {
      const stored = makeSkippedTransaction({
        id: "txn-skip-1",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-02",
        scheduledDate: "2026-02-15",
      });

      const merged = mergeTransactionsWithProjections([stored], [], [rule()], WINDOW_Q1, "user-1");

      expect(ids(merged)).toEqual([
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "txn-skip-1",
        "proj_exp-1::2026-03-15::exp-1_2026-03",
      ]);
      expect(statuses(merged)).toEqual(["projected", "skipped", "projected"]);
    });

    it("replaces the projection with a persisted still-projected row (edited amount survives)", () => {
      const stored = makeTransaction({
        id: "txn-edited-1",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-01-15",
        projectedAmount: 900,
        status: "projected",
      });

      const merged = mergeTransactionsWithProjections(
        [stored],
        [],
        [rule()],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      // The rule says 1,200; the persisted row says 900. Stored wins.
      expect(ids(merged)).toEqual(["txn-edited-1"]);
      expect(merged[0].projectedAmount).toBe(900);
    });

    it("leaves sibling occurrences of the same rule as projections", () => {
      const stored = storedForRule({
        id: "txn-feb",
        occurrenceId: "exp-1_2026-02",
        scheduledDate: "2026-02-15",
      });

      const merged = mergeTransactionsWithProjections(
        [stored],
        [],
        [makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" })],
        { start: "2026-01-01", end: "2026-04-30" },
        "user-1"
      );

      expect(occurrenceIds(merged)).toEqual([
        "exp-1_2026-01",
        "exp-1_2026-02",
        "exp-1_2026-03",
        "exp-1_2026-04",
      ]);
      expect(statuses(merged)).toEqual(["projected", "completed", "projected", "projected"]);
    });

    it("matches on occurrenceId even after the user moved the date", () => {
      // Rule schedules Jan 15; the user dragged the payment to Jan 20 and paid on Jan 22.
      const stored = storedForRule({
        id: "txn-moved",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-01-20",
        actualDate: "2026-01-22",
        projectedAmount: 1_200,
        actualAmount: 1_200,
      });

      const merged = mergeTransactionsWithProjections(
        [stored],
        [],
        [rule()],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      // The Jan 15 projection must be gone, not sitting next to the moved row.
      expect(ids(merged)).toEqual(["txn-moved", "proj_exp-1::2026-02-15::exp-1_2026-02"]);
      expect(sortKeys(merged)).toEqual(["2026-01-22", "2026-02-15"]);
    });

    it("does not append a consumed stored row a second time", () => {
      const source = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const storedIncome = makeCompletedTransaction({
        id: "txn-pay-jan",
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-01",
        scheduledDate: "2026-01-01",
        projectedAmount: 3_000,
        actualAmount: 3_050,
      });
      const storedExpense = storedForRule({
        id: "txn-rent-feb",
        occurrenceId: "exp-1_2026-02",
        scheduledDate: "2026-02-15",
      });

      const merged = mergeTransactionsWithProjections(
        [storedIncome, storedExpense],
        [source],
        [makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" })],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      // 4 occurrences in the window, 2 of them realized => exactly 4 rows, no repeats.
      expect(merged).toHaveLength(4);
      expect(duplicates(ids(merged))).toEqual([]);
      expect(ids(merged)).toEqual([
        "txn-pay-jan",
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "proj_inc-1::2026-02-01::inc-1_2026-02",
        "txn-rent-feb",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("stored rows with no occurrenceId (legacy data)", () => {
    it("keeps a legacy stored row whose date matches no projection, without dropping projections", () => {
      // Fallback key is `exp-1-2026-01-18`, which matches nothing the rule schedules.
      const legacy = storedForRule({
        id: "txn-legacy-off",
        occurrenceId: undefined,
        scheduledDate: "2026-01-18",
        actualDate: "2026-01-18",
      });

      const merged = mergeTransactionsWithProjections(
        [legacy],
        [],
        [makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" })],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      expect(ids(merged)).toEqual(["proj_exp-1::2026-01-15::exp-1_2026-01", "txn-legacy-off"]);
      expect(statuses(merged)).toEqual(["projected", "completed"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("rows that must never vanish", () => {
    const rule = () => makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });

    it("always includes manual transactions, whatever their status", () => {
      const manualProjected = makeManualTransaction({
        id: "mn-projected",
        scheduledDate: "2026-01-02",
        status: "projected",
      });
      const manualCompleted = makeManualTransaction({
        id: "mn-completed",
        scheduledDate: "2026-01-03",
        actualDate: "2026-01-03",
        actualAmount: 42,
        status: "completed",
      });
      const manualSkipped = makeManualTransaction({
        id: "mn-skipped",
        scheduledDate: "2026-01-04",
        status: "skipped",
      });

      const merged = mergeTransactionsWithProjections(
        [manualProjected, manualCompleted, manualSkipped],
        [],
        [rule()],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      // All three manual rows survive *in addition to* the single Jan projection.
      expect(ids(merged)).toEqual([
        "mn-projected",
        "mn-completed",
        "mn-skipped",
        "proj_exp-1::2026-01-15::exp-1_2026-01",
      ]);
      expect(merged).toHaveLength(4);
    });

    it("includes an orphaned stored row whose source no longer exists", () => {
      const orphan = makeCompletedTransaction({
        id: "txn-orphan",
        sourceType: "expense_rule",
        sourceId: "deleted-rule-9",
        occurrenceId: "deleted-rule-9_2026-01",
        scheduledDate: "2026-01-10",
        actualAmount: 250,
      });

      const merged = mergeTransactionsWithProjections(
        [orphan],
        [],
        [rule()],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      expect(ids(merged)).toEqual(["txn-orphan", "proj_exp-1::2026-01-15::exp-1_2026-01"]);
      expect(merged[0].actualAmount).toBe(250);
    });

    it("includes a stored row whose source is now inactive", () => {
      const stored = storedForRule({
        id: "txn-retired",
        sourceId: "exp-old",
        occurrenceId: "exp-old_2026-01",
        scheduledDate: "2026-01-08",
      });

      const merged = mergeTransactionsWithProjections(
        [stored],
        [],
        [rule(), makeExpenseRule({ id: "exp-old", isActive: false, startDate: "2026-01-08" })],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      expect(ids(merged)).toEqual(["txn-retired", "proj_exp-1::2026-01-15::exp-1_2026-01"]);
    });

    it("includes stored rows dated before and after the view window", () => {
      const before = storedForRule({
        id: "txn-before",
        occurrenceId: "exp-1_2025-12",
        scheduledDate: "2025-12-15",
        actualDate: "2025-12-14",
      });
      const after = storedForRule({
        id: "txn-after",
        occurrenceId: "exp-1_2026-05",
        scheduledDate: "2026-05-15",
        actualDate: "2026-05-16",
      });

      const merged = mergeTransactionsWithProjections(
        [before, after],
        [],
        [rule()],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      // Real money outside the window is still real money — it must be carried through.
      expect(ids(merged)).toEqual([
        "txn-before",
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "proj_exp-1::2026-02-15::exp-1_2026-02",
        "txn-after",
      ]);
      expect(sortKeys(merged)).toEqual(["2025-12-14", "2026-01-15", "2026-02-15", "2026-05-16"]);
    });
  });

  // -------------------------------------------------------------------------
  describe("ordering", () => {
    it("sorts a completed row by its actualDate, not its scheduledDate", () => {
      const source = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-02-15" });
      // Rent scheduled for Feb 15 but actually paid early, on Jan 5.
      const paidEarly = storedForRule({
        id: "txn-early",
        occurrenceId: "exp-1_2026-02",
        scheduledDate: "2026-02-15",
        actualDate: "2026-01-05",
        projectedAmount: 1_200,
        actualAmount: 1_200,
      });

      const merged = mergeTransactionsWithProjections(
        [paidEarly],
        [source],
        [rule],
        { start: "2026-01-01", end: "2026-02-28" },
        "user-1"
      );

      expect(ids(merged)).toEqual([
        "proj_inc-1::2026-01-01::inc-1_2026-01",
        "txn-early",
        "proj_inc-1::2026-02-01::inc-1_2026-02",
      ]);
      expect(sortKeys(merged)).toEqual(["2026-01-01", "2026-01-05", "2026-02-01"]);
    });

    it("orders every row by actualDate || scheduledDate across sources, rules and manual rows", () => {
      const source = makeIncomeSource({ id: "inc-1", startDate: "2026-01-01" });
      const rule = makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" });
      const manual = makeManualTransaction({
        id: "mn-1",
        scheduledDate: "2026-01-31",
        actualDate: "2026-01-09",
        status: "completed",
      });
      const orphan = makeCompletedTransaction({
        id: "txn-orphan",
        sourceType: "expense_rule",
        sourceId: "gone",
        occurrenceId: "gone_2026-01",
        scheduledDate: "2026-01-20",
        actualDate: "2026-01-21",
      });

      const merged = mergeTransactionsWithProjections(
        [manual, orphan],
        [source],
        [rule],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      expect(sortKeys(merged)).toEqual(["2026-01-01", "2026-01-09", "2026-01-15", "2026-01-21"]);
      expect(ids(merged)).toEqual([
        "proj_inc-1::2026-01-01::inc-1_2026-01",
        "mn-1",
        "proj_exp-1::2026-01-15::exp-1_2026-01",
        "txn-orphan",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe("occurrence overrides", () => {
    /**
     * The January occurrence (`exp-1_2026-01`) is rescheduled to Feb 20 and
     * repriced to 999, which also moves it *after* the untouched Feb 15 one.
     */
    const rescheduledRule = () =>
      makeExpenseRule({
        id: "exp-1",
        startDate: "2026-01-15",
        occurrenceOverrides: { "exp-1_2026-01": { scheduledDate: "2026-02-20", amount: 999 } },
      });

    it("reflects the override date in the projection id and in the sort position", () => {
      const merged = mergeTransactionsWithProjections([], [], [rescheduledRule()], WINDOW_Q1, "u");

      // occurrenceId stays anchored to the logical period; only scheduledDate moves.
      expect(ids(merged)).toEqual([
        "proj_exp-1::2026-02-15::exp-1_2026-02",
        "proj_exp-1::2026-02-20::exp-1_2026-01",
        "proj_exp-1::2026-03-15::exp-1_2026-03",
      ]);
      expect(merged[1].projectedAmount).toBe(999);
      expect(sortKeys(merged)).toEqual(["2026-02-15", "2026-02-20", "2026-03-15"]);
    });

    it("still matches a stored row for the overridden occurrence", () => {
      const stored = storedForRule({
        id: "txn-rescheduled",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-02-20",
        actualDate: "2026-02-21",
        projectedAmount: 999,
        actualAmount: 999,
      });

      const merged = mergeTransactionsWithProjections(
        [stored],
        [],
        [rescheduledRule()],
        WINDOW_Q1,
        "u"
      );

      expect(ids(merged)).toEqual([
        "proj_exp-1::2026-02-15::exp-1_2026-02",
        "txn-rescheduled",
        "proj_exp-1::2026-03-15::exp-1_2026-03",
      ]);
      expect(merged).toHaveLength(3);
    });

    it("drops a skipped occurrence from the projections entirely", () => {
      const rule = makeExpenseRule({
        id: "exp-1",
        startDate: "2026-01-15",
        occurrenceOverrides: { "exp-1_2026-02": { skipped: true } },
      });

      const merged = mergeTransactionsWithProjections([], [], [rule], WINDOW_Q1, "u");

      expect(occurrenceIds(merged)).toEqual(["exp-1_2026-01", "exp-1_2026-03"]);
    });
  });

  // -------------------------------------------------------------------------
  // Confirmed bugs. Each test asserts the CORRECT behaviour and is marked
  // `it.fails`, so it passes today and turns red the moment the bug is fixed.
  // -------------------------------------------------------------------------
  describe("known defects", () => {
    /**
     * DEFECT 1a — colliding occurrence ids produce duplicate merged rows.
     *
     * occurrenceCalculator.ts:50-57 (the `daily` case) pushes one occurrence per
     * calendar day and then runs each through `adjustForWeekend`. With
     * weekendAdjustment "after", Sat 2026-01-03 -> Mon 01-05 and Sun 01-04 ->
     * Mon 01-05, so Monday is emitted three times. `generateOccurrenceId`
     * (occurrenceIdGenerator.ts:67-68) keys daily occurrences by the *adjusted*
     * date, so all three get occurrenceId `exp-1_2026-01-05`, and
     * projectionMerger.ts:57-64 therefore mints the same `proj_` id three times.
     *
     * Correct behaviour: one row per real occurrence, so merged ids are unique.
     */
    it.fails(
      "KNOWN DEFECT: keeps merged ids unique for a daily rule with weekend adjustment",
      () => {
        const rule = makeExpenseRule({
          id: "exp-1",
          frequency: "daily",
          weekendAdjustment: "after",
          startDate: "2026-01-01",
        });

        const merged = mergeTransactionsWithProjections(
          [],
          [],
          [rule],
          { start: "2026-01-01", end: "2026-01-07" },
          "user-1"
        );

        expect(duplicates(ids(merged))).toEqual([]);
        expect(duplicates(occurrenceIds(merged))).toEqual([]);
      }
    );

    /**
     * DEFECT 1b — the collision above also defeats "stored wins".
     *
     * projectionMerger.ts:46-54 deletes the stored row from the lookup map the
     * first time a projection key matches, so the 2nd and 3rd colliding
     * projections fall through to the projection branch. The result is the
     * completed row PLUS two live projections for the same occurrence: the
     * payment is counted three times.
     *
     * Correct behaviour: exactly one row carries occurrenceId `exp-1_2026-01-05`,
     * and it is the stored one.
     */
    it.fails(
      "KNOWN DEFECT: emits one row per occurrence when a stored row matches a collided key",
      () => {
        const rule = makeExpenseRule({
          id: "exp-1",
          frequency: "daily",
          weekendAdjustment: "after",
          startDate: "2026-01-01",
        });
        const stored = storedForRule({
          id: "txn-monday",
          occurrenceId: "exp-1_2026-01-05",
          scheduledDate: "2026-01-05",
        });

        const merged = mergeTransactionsWithProjections(
          [stored],
          [],
          [rule],
          { start: "2026-01-01", end: "2026-01-07" },
          "user-1"
        );

        const forMonday = merged.filter((t) => t.occurrenceId === "exp-1_2026-01-05");
        expect(ids(forMonday)).toEqual(["txn-monday"]);
      }
    );

    /**
     * DEFECT 2 — the `sourceId-scheduledDate` fallback key can never match, so
     * legacy stored rows double-count.
     *
     * projectionMerger.ts:15-16 keys a row by `occurrenceId` and only falls back
     * to `${sourceId}-${scheduledDate}` when the occurrenceId is missing. Every
     * generated projection always carries an occurrenceId
     * (transactionFactory.ts:55, fed by expenseProjections.ts:57 /
     * incomeProjections.ts:38), and the occurrenceId format uses `_` as its
     * separator, so a stored row without an occurrenceId never collides with a
     * projection key. The fallback branch is unreachable for matching: the
     * legacy completed row is appended by the second pass
     * (projectionMerger.ts:73-84) *next to* its own projection.
     *
     * Correct behaviour: the legacy row on the projection's date replaces it —
     * two rows here (Jan realized, Feb projected), not three.
     */
    it.fails(
      "KNOWN DEFECT: a stored row without an occurrenceId replaces the projection on its date",
      () => {
        const legacy = storedForRule({
          id: "txn-legacy",
          occurrenceId: undefined,
          scheduledDate: "2026-01-15",
          actualDate: "2026-01-15",
          projectedAmount: 1_200,
          actualAmount: 1_200,
        });

        const merged = mergeTransactionsWithProjections(
          [legacy],
          [],
          [makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" })],
          { start: "2026-01-01", end: "2026-02-28" },
          "user-1"
        );

        expect(ids(merged)).toEqual(["txn-legacy", "proj_exp-1::2026-02-15::exp-1_2026-02"]);
      }
    );

    /**
     * DEFECT 3 — two stored rows sharing one occurrenceId: the first is
     * silently deleted.
     *
     * projectionMerger.ts:37-43 builds `storedByKey` with `Map.set`, so the last
     * row for a key overwrites the earlier one. The matching projection then
     * consumes and deletes that key (projectionMerger.ts:52), leaving the
     * overwritten row with no key in the map, so the second pass
     * (projectionMerger.ts:79) skips it too. `txn-part-1` disappears from the
     * ledger entirely — money that actually happened vanishes.
     *
     * Correct behaviour: both realized rows are returned.
     */
    it.fails("KNOWN DEFECT: keeps both stored rows when two share the same occurrenceId", () => {
      const firstPayment = storedForRule({
        id: "txn-part-1",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-01-15",
        actualDate: "2026-01-15",
        actualAmount: 600,
      });
      const secondPayment = storedForRule({
        id: "txn-part-2",
        occurrenceId: "exp-1_2026-01",
        scheduledDate: "2026-01-15",
        actualDate: "2026-01-16",
        actualAmount: 600,
      });

      const merged = mergeTransactionsWithProjections(
        [firstPayment, secondPayment],
        [],
        [makeExpenseRule({ id: "exp-1", startDate: "2026-01-15" })],
        { start: "2026-01-01", end: "2026-01-31" },
        "user-1"
      );

      expect(ids(merged)).toEqual(["txn-part-1", "txn-part-2"]);
    });
  });
});
