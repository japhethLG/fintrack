import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../../helpers/firebaseConfigMock"));

import type {
  DeletableDataType,
  ExpenseRule,
  IncomeSource,
  OccurrenceOverride,
  Transaction,
  UserProfile,
} from "@/lib/types";
import {
  deleteAllUserData,
  deleteProjectedTransactions,
  deleteSelectiveUserData,
  migratePendingToOverrides,
  migrateToInitialBalance,
  normalizePartialTransactions,
} from "@/lib/firebase/firestore/migrations";
import { getUserProfile } from "@/lib/firebase/firestore/users";
import { computeBalanceFromTransactions } from "@/lib/logic/balanceCalculator/computedBalance";
import { generateReconciliationReport } from "@/lib/logic/balanceCalculator/reconciliation";
import { generateOccurrenceId } from "@/lib/logic/projectionEngine/occurrenceIdGenerator";
import * as store from "../../helpers/firestoreEmulator";
import {
  makeAlert,
  makeBalanceSnapshot,
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  makeProjectedTransaction,
  makeSkippedTransaction,
  makeTransaction,
  makeUserProfile,
} from "../../helpers/builders";
import { d } from "../../helpers/dates";
import { freezeToday } from "../../helpers/time";

/**
 * THEME: the one-time migrations and destructive data operations in
 * `app/lib/firebase/firestore/migrations.ts`.
 *
 * Two reasons this file pins state rather than return values alone:
 *
 *  1. `migrateToInitialBalance` runs on EVERY login (app/contexts/AuthContext.tsx:73),
 *     so it is exercised more often than any other write in the app and must be
 *     idempotent — every test here checks the persisted document, and the
 *     idempotency block runs the migration twice and diffs the op log.
 *  2. the delete helpers are irreversible. Their queries are all
 *     `where("userId", "==", userId)`, so every one of them gets a second seeded
 *     user whose data must survive untouched; cross-user leakage in a delete is
 *     unrecoverable for the victim.
 *
 * The real repo code runs against the in-memory firestore emulator — nothing in
 * `migrations.ts` or in the modules it calls (`users.ts`, `incomeSources.ts`,
 * `expenseRules.ts`, `occurrenceIdGenerator.ts`) is stubbed. Assertions about
 * balance *consistency* deliberately go through the app's own source of truth,
 * `computeBalanceFromTransactions`, because that is what the settings page and
 * `syncComputedBalance` use to decide what the user's balance "really" is.
 */

// ============================================================================
// LOCAL HELPERS
//
// Gaps in tests/helpers/builders.ts covered here:
//   - `makeTransaction` types `status` as TransactionStatus, which no longer
//     includes the legacy "pending"/"partial" values these migrations exist to
//     clean up, and `Transaction` has no `parentTransactionId` field even though
//     `normalizePartialTransactions` queries on one. `legacyTxn` builds those
//     legacy shapes without weakening the shared builder.
//   - there is no builder for a pre-`initialBalance` user profile (the field is
//     required on `UserProfile`), which is the entire input space of
//     `migrateToInitialBalance`.
// ============================================================================

const USER = "user-1";
const OTHER = "user-2";
const TODAY = "2026-07-15";

/** A transaction document as the OLD schema wrote it. */
type LegacyTransaction = Omit<Transaction, "status"> & {
  status: string;
  parentTransactionId?: string;
};

type LegacyOverrides = Partial<Transaction> & { parentTransactionId?: string };

const legacyTxn = (status: string, overrides: LegacyOverrides = {}): LegacyTransaction => ({
  ...makeTransaction(overrides),
  status,
});

/** Legacy "pending" row: the input to `migratePendingToOverrides`. */
const pendingTxn = (overrides: LegacyOverrides = {}): LegacyTransaction =>
  legacyTxn("pending", overrides);

/** Legacy "partial" row: the input to `normalizePartialTransactions`. */
const partialTxn = (overrides: LegacyOverrides = {}): LegacyTransaction =>
  legacyTxn("partial", overrides);

/**
 * Legacy "remainder" child row. `Transaction` has no `parentTransactionId`, so
 * the shared projected builder cannot express this shape.
 */
const childTxn = (overrides: LegacyOverrides = {}): LegacyTransaction =>
  legacyTxn("projected", overrides);

/** Seed a user profile document (it carries its own uid, as getUserProfile requires). */
const seedProfile = (uid: string, overrides: Partial<UserProfile> = {}): void => {
  store.__seed("users", uid, makeUserProfile({ uid, ...overrides }));
};

/**
 * Seed a profile that predates the `initialBalance` field. `UserProfile` requires
 * the field, so it has to be stripped after the builder runs.
 */
const seedLegacyProfile = (uid: string, overrides: Partial<UserProfile> = {}): void => {
  const profile: Record<string, unknown> = { ...makeUserProfile({ uid, ...overrides }) };
  delete profile.initialBalance;
  store.__seed("users", uid, profile);
};

/** Persisted profile as a loose record — legacy docs are missing typed fields. */
const rawProfile = (uid: string): Record<string, unknown> => {
  const found = store.__get<Record<string, unknown>>("users", uid);
  if (!found) throw new Error(`expected users/${uid} to exist`);
  return found;
};

/** Persisted income source document, failing loudly if absent. */
const storedSource = (id: string): IncomeSource => {
  const found = store.__get<IncomeSource>("income_sources", id);
  if (!found) throw new Error(`expected income_sources/${id} to exist`);
  return found;
};

/** Persisted expense rule document, failing loudly if absent. */
const storedRule = (id: string): ExpenseRule => {
  const found = store.__get<ExpenseRule>("expense_rules", id);
  if (!found) throw new Error(`expected expense_rules/${id} to exist`);
  return found;
};

/** Override map of a persisted source/rule, defaulted so assertions never crash. */
const overridesOf = (
  collectionName: "income_sources" | "expense_rules",
  id: string
): Record<string, OccurrenceOverride> => {
  const doc =
    collectionName === "income_sources"
      ? (storedSource(id) as { occurrenceOverrides?: Record<string, OccurrenceOverride> })
      : (storedRule(id) as { occurrenceOverrides?: Record<string, OccurrenceOverride> });
  return doc.occurrenceOverrides ?? {};
};

/** Document ids present in a collection, sorted for stable comparison. */
const idsIn = (collectionName: string): string[] =>
  store
    .__all(collectionName)
    .map((row) => row.id)
    .sort();

/** `seconds` of a persisted Timestamp-shaped value, or undefined. */
const tsSeconds = (value: unknown): number | undefined =>
  (value as { seconds?: number } | undefined)?.seconds;

/** Epoch seconds of local midnight on a calendar day. */
const secondsAt = (ymd: string): number => Math.floor(d(ymd).getTime() / 1000);

const ALL_TYPES: DeletableDataType[] = [
  "income_sources",
  "expense_rules",
  "transactions",
  "balance_history",
  "alerts",
];

/** One document in every deletable collection, owned by `uid`. */
const seedOneOfEverything = (uid: string, suffix: string): void => {
  store.__seedEntities("income_sources", [makeIncomeSource({ id: `inc-${suffix}`, userId: uid })]);
  store.__seedEntities("expense_rules", [makeExpenseRule({ id: `exp-${suffix}`, userId: uid })]);
  store.__seedEntities("transactions", [makeTransaction({ id: `txn-${suffix}`, userId: uid })]);
  store.__seedEntities("balance_history", [
    makeBalanceSnapshot({ id: `snap-${suffix}`, userId: uid }),
  ]);
  store.__seedEntities("alerts", [makeAlert({ id: `alert-${suffix}`, userId: uid })]);
};

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ============================================================================
// migrateToInitialBalance
// ============================================================================

describe("migrateToInitialBalance", () => {
  describe("legacy profile with no initialBalance field", () => {
    it("backfills initialBalance from currentBalance", async () => {
      seedLegacyProfile(USER, { currentBalance: 4_250 });

      await migrateToInitialBalance(USER);

      expect(rawProfile(USER).initialBalance).toBe(4_250);
    });

    it("leaves currentBalance untouched", async () => {
      seedLegacyProfile(USER, { currentBalance: 4_250 });

      await migrateToInitialBalance(USER);

      expect(rawProfile(USER).currentBalance).toBe(4_250);
    });

    it("treats an explicit null as missing and backfills it", async () => {
      const profile: Record<string, unknown> = {
        ...makeUserProfile({ uid: USER, currentBalance: 900 }),
        initialBalance: null,
      };
      store.__seed("users", USER, profile);

      await migrateToInitialBalance(USER);

      expect(rawProfile(USER).initialBalance).toBe(900);
    });

    it("writes exactly one update, carrying initialBalance and a fresh updatedAt", async () => {
      seedLegacyProfile(USER, { currentBalance: 4_250 });

      await migrateToInitialBalance(USER);

      const ops = store.__opsFor("users");
      expect(ops).toHaveLength(1);
      expect(ops[0].op).toBe("update");
      expect(ops[0].id).toBe(USER);
      expect(ops[0].data?.initialBalance).toBe(4_250);
      expect(tsSeconds(ops[0].data?.updatedAt)).toBe(secondsAt(TODAY));
    });
  });

  describe("profile that already has initialBalance", () => {
    it("is a no-op — it does not write at all", async () => {
      seedProfile(USER, { currentBalance: 3_000, initialBalance: 7_500 });

      await migrateToInitialBalance(USER);

      expect(store.__ops).toHaveLength(0);
      expect(rawProfile(USER).initialBalance).toBe(7_500);
      expect(rawProfile(USER).currentBalance).toBe(3_000);
    });

    it("preserves an initialBalance of 0 instead of overwriting it with currentBalance", async () => {
      // 0 is falsy but a legitimate baseline: a user who started from nothing and
      // has since been paid. migrations.ts:221 tests for undefined/null rather
      // than falsiness, so the 0 must survive.
      seedProfile(USER, { currentBalance: 5_000, initialBalance: 0 });

      await migrateToInitialBalance(USER);

      expect(rawProfile(USER).initialBalance).toBe(0);
      expect(store.__ops).toHaveLength(0);
    });
  });

  describe("missing profile", () => {
    it("resolves without throwing and writes nothing", async () => {
      await expect(migrateToInitialBalance("nobody")).resolves.toBeUndefined();

      expect(store.__ops).toHaveLength(0);
      expect(store.__count("users")).toBe(0);
    });
  });

  describe("idempotency (this runs on every login)", () => {
    it("the second run over a migrated legacy profile writes nothing more", async () => {
      seedLegacyProfile(USER, { currentBalance: 4_250 });

      await migrateToInitialBalance(USER);
      const afterFirst = rawProfile(USER);
      const opsAfterFirst = store.__opsFor("users").length;

      await migrateToInitialBalance(USER);

      expect(store.__opsFor("users")).toHaveLength(opsAfterFirst);
      expect(rawProfile(USER)).toStrictEqual(afterFirst);
    });

    it("never writes for a profile that already has the field, however many times it runs", async () => {
      seedProfile(USER, { currentBalance: 1_000, initialBalance: 1_000 });

      await migrateToInitialBalance(USER);
      await migrateToInitialBalance(USER);
      await migrateToInitialBalance(USER);

      expect(store.__ops).toHaveLength(0);
    });
  });

  describe("cross-user isolation", () => {
    it("only touches the profile of the user being migrated", async () => {
      seedLegacyProfile(USER, { currentBalance: 4_250 });
      seedLegacyProfile(OTHER, { currentBalance: 999 });
      const otherBefore = rawProfile(OTHER);

      await migrateToInitialBalance(USER);

      expect(rawProfile(OTHER)).toStrictEqual(otherBefore);
      expect(rawProfile(OTHER).initialBalance).toBeUndefined();
      expect(store.__opsFor("users").map((op) => op.id)).toEqual([USER]);
    });
  });

  describe("KNOWN DEFECTS", () => {
    it.fails(
      "KNOWN DEFECT: the derived initialBalance double-counts completed history",
      async () => {
        // app/lib/firebase/firestore/migrations.ts:223 sets initialBalance = currentBalance.
        // But currentBalance ALREADY includes every completed transaction, and
        // computeBalanceFromTransactions (app/lib/logic/balanceCalculator/computedBalance.ts:16)
        // — the app's declared source of truth — re-applies those same completed
        // transactions on top of initialBalance.
        // Correct behaviour: initialBalance must be back-computed as
        //   currentBalance - net(completed) = 10_000 - (3_000 - 4_500) = 11_500,
        // so that the stored balance and the computed balance agree.
        // Consequence as written: on the first login after the upgrade the settings
        // page reports a phantom discrepancy equal to the net of all completed
        // history (here 1_500), and "fix discrepancy" / syncComputedBalance
        // overwrites the user's real balance with the double-counted figure.
        seedLegacyProfile(USER, { currentBalance: 10_000 });
        const history = [
          makeCompletedTransaction({
            id: "h1",
            userId: USER,
            type: "income",
            projectedAmount: 3_000,
            actualAmount: 3_000,
            scheduledDate: "2026-01-05",
          }),
          makeCompletedTransaction({
            id: "h2",
            userId: USER,
            type: "expense",
            projectedAmount: 4_500,
            actualAmount: 4_500,
            scheduledDate: "2026-01-20",
          }),
        ];
        store.__seedEntities("transactions", history);

        await migrateToInitialBalance(USER);

        // Real reconciliation code path: reads the migrated profile back out of
        // firestore and recomputes the balance from the same transactions.
        const report = await generateReconciliationReport(USER, history);
        expect(report.difference).toBe(0);
      }
    );

    it.fails(
      "KNOWN DEFECT: a legacy profile with no currentBalance never gets an initialBalance",
      async () => {
        // The migration's stated job (AuthContext.tsx:72 "ensure initialBalance
        // field exists") is not met for the oldest documents. migrations.ts:223
        // passes `initialBalance: profile.currentBalance`, i.e. undefined, and
        // removeUndefined (app/lib/firebase/firestore/utils.ts:10) strips it, so
        // updateUserProfile writes only `updatedAt`.
        // Correct behaviour: after the migration initialBalance is a number
        // (0 when there is nothing to derive it from).
        // Consequence as written: the field stays missing on every subsequent
        // login, and computeBalanceFromTransactions(undefined, txns) yields NaN —
        // which syncComputedBalance then persists as the user's balance.
        const profile: Record<string, unknown> = { ...makeUserProfile({ uid: USER }) };
        delete profile.initialBalance;
        delete profile.currentBalance;
        store.__seed("users", USER, profile);

        await migrateToInitialBalance(USER);

        expect(typeof rawProfile(USER).initialBalance).toBe("number");
        const migrated = await getUserProfile(USER);
        expect(migrated).not.toBeNull();
        expect(Number.isNaN(computeBalanceFromTransactions(migrated!.initialBalance, []))).toBe(
          false
        );
      }
    );
  });
});

// ============================================================================
// migratePendingToOverrides
// ============================================================================

describe("migratePendingToOverrides", () => {
  it("returns 0 and writes nothing when there are no pending rows", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "p1", userId: USER }),
      makeCompletedTransaction({ id: "c1", userId: USER }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(0);
    expect(store.__ops).toHaveLength(0);
    expect(idsIn("transactions")).toEqual(["c1", "p1"]);
  });

  it("converts an income-source pending row into an override and deletes the row", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "inc-1", userId: USER })]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "pend-1",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-17",
        projectedAmount: 3_250,
        notes: "raise applied",
      }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(overridesOf("income_sources", "inc-1")["inc-1_2026-03"]).toEqual({
      scheduledDate: "2026-03-17",
      amount: 3_250,
      notes: "raise applied",
    });
    expect(store.__get("transactions", "pend-1")).toBeUndefined();
  });

  it("converts an expense-rule pending row into an override on the rule", async () => {
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1", userId: USER })]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "pend-1",
        userId: USER,
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-04",
        scheduledDate: "2026-04-02",
        projectedAmount: 1_310,
        notes: "rent increase",
      }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(overridesOf("expense_rules", "exp-1")["exp-1_2026-04"]).toEqual({
      scheduledDate: "2026-04-02",
      amount: 1_310,
      notes: "rent increase",
    });
    expect(store.__get("transactions", "pend-1")).toBeUndefined();
  });

  it("regenerates a missing occurrenceId from the source schedule (monthly)", async () => {
    const source = makeIncomeSource({
      id: "inc-1",
      userId: USER,
      frequency: "monthly",
      startDate: "2026-01-01",
    });
    store.__seedEntities("income_sources", [source]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "pend-1",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: undefined,
        scheduledDate: "2026-03-15",
        projectedAmount: 3_000,
        notes: "n/a",
      }),
    ]);

    await migratePendingToOverrides(USER);

    const keys = Object.keys(overridesOf("income_sources", "inc-1"));
    expect(keys).toEqual(["inc-1_2026-03"]);
    // Same id the engine itself would mint for that occurrence.
    expect(keys[0]).toBe(
      generateOccurrenceId("inc-1", "monthly", d("2026-03-15"), "2026-01-01", {})
    );
  });

  it("regenerates a missing occurrenceId using the source startDate and scheduleConfig (bi-weekly)", async () => {
    // A bi-weekly id is an index counted from startDate with intervalWeeks, so
    // this fails loudly if either field is dropped on the way through.
    const source = makeIncomeSource({
      id: "inc-1",
      userId: USER,
      frequency: "bi-weekly",
      startDate: "2026-01-01",
      scheduleConfig: { intervalWeeks: 2 },
    });
    store.__seedEntities("income_sources", [source]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "pend-1",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: undefined,
        scheduledDate: "2026-02-12",
        projectedAmount: 1_500,
      }),
    ]);

    await migratePendingToOverrides(USER);

    // 2026-01-01 -> 2026-02-12 is 42 days = the 4th bi-weekly slot.
    expect(Object.keys(overridesOf("income_sources", "inc-1"))).toEqual(["inc-1_BW4"]);
  });

  it("deletes a pending row whose source no longer exists, writing no override", async () => {
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "orphan",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-gone",
        scheduledDate: "2026-03-01",
      }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(store.__get("transactions", "orphan")).toBeUndefined();
    expect(store.__count("income_sources")).toBe(0);
    expect(store.__opsFor("income_sources")).toHaveLength(0);
    expect(store.__opsFor("expense_rules")).toHaveLength(0);
  });

  it("deletes a pending row that has no sourceId", async () => {
    store.__seedEntities("transactions", [
      pendingTxn({ id: "manual", userId: USER, sourceType: "manual", sourceId: undefined }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(store.__count("transactions")).toBe(0);
    expect(store.__opsFor("income_sources")).toHaveLength(0);
    expect(store.__opsFor("expense_rules")).toHaveLength(0);
  });

  it("deletes a pending row that has a sourceId but no sourceType", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "inc-1", userId: USER })]);
    store.__seedEntities("transactions", [
      pendingTxn({ id: "typeless", userId: USER, sourceType: undefined, sourceId: "inc-1" }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(store.__count("transactions")).toBe(0);
    expect(overridesOf("income_sources", "inc-1")).toEqual({});
  });

  it("leaves projected, completed and skipped rows alone", async () => {
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "inc-1", userId: USER })]);
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "proj", userId: USER }),
      makeCompletedTransaction({ id: "done", userId: USER }),
      makeSkippedTransaction({ id: "skip", userId: USER }),
      pendingTxn({
        id: "pend",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-10",
      }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(idsIn("transactions")).toEqual(["done", "proj", "skip"]);
  });

  it("ignores another user's pending rows entirely", async () => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({ id: "inc-1", userId: USER }),
      makeIncomeSource({ id: "inc-2", userId: OTHER }),
    ]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "mine",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-10",
      }),
      pendingTxn({
        id: "theirs",
        userId: OTHER,
        sourceType: "income_source",
        sourceId: "inc-2",
        occurrenceId: "inc-2_2026-03",
        scheduledDate: "2026-03-11",
      }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(1);
    expect(idsIn("transactions")).toEqual(["theirs"]);
    expect(overridesOf("income_sources", "inc-2")).toEqual({});
  });

  it("leaves overrides for other occurrences on the same source in place", async () => {
    store.__seedEntities("income_sources", [
      makeIncomeSource({
        id: "inc-1",
        userId: USER,
        occurrenceOverrides: { "inc-1_2026-01": { skipped: true } },
      }),
    ]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "pend",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-10",
        projectedAmount: 3_100,
      }),
    ]);

    await migratePendingToOverrides(USER);

    const overrides = overridesOf("income_sources", "inc-1");
    expect(Object.keys(overrides).sort()).toEqual(["inc-1_2026-01", "inc-1_2026-03"]);
    expect(overrides["inc-1_2026-01"]).toEqual({ skipped: true });
  });

  it("mixes income, expense, orphan and sourceless rows in one pass and leaves no pending row behind", async () => {
    // The function interleaves awaited per-source writes with a single batched
    // delete committed at the end; this pins the final state of every document.
    store.__seedEntities("income_sources", [makeIncomeSource({ id: "inc-1", userId: USER })]);
    store.__seedEntities("expense_rules", [makeExpenseRule({ id: "exp-1", userId: USER })]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "p-inc",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-10",
        projectedAmount: 3_100,
      }),
      pendingTxn({
        id: "p-exp",
        userId: USER,
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-03",
        scheduledDate: "2026-03-05",
        projectedAmount: 1_250,
      }),
      pendingTxn({
        id: "p-orphan",
        userId: USER,
        sourceType: "expense_rule",
        sourceId: "exp-gone",
        scheduledDate: "2026-03-06",
      }),
      pendingTxn({ id: "p-manual", userId: USER, sourceType: "manual", sourceId: undefined }),
      makeCompletedTransaction({ id: "keep", userId: USER }),
    ]);

    const migrated = await migratePendingToOverrides(USER);

    expect(migrated).toBe(4);
    expect(idsIn("transactions")).toEqual(["keep"]);
    expect(Object.keys(overridesOf("income_sources", "inc-1"))).toEqual(["inc-1_2026-03"]);
    expect(Object.keys(overridesOf("expense_rules", "exp-1"))).toEqual(["exp-1_2026-03"]);
    expect(
      store.__all<LegacyTransaction>("transactions").filter((row) => row.status === "pending")
    ).toEqual([]);
  });

  it("commits every override write before any pending row is deleted", async () => {
    // Ordering matters for crash safety: the overrides are awaited one by one
    // while the deletes sit in a batch that only commits at the very end, so an
    // interrupted run leaves the pending rows (re-runnable) rather than dropping
    // them with no override written.
    store.__seedEntities("income_sources", [
      makeIncomeSource({ id: "inc-1", userId: USER }),
      makeIncomeSource({ id: "inc-2", userId: USER }),
    ]);
    store.__seedEntities("transactions", [
      pendingTxn({
        id: "p1",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-1",
        occurrenceId: "inc-1_2026-03",
        scheduledDate: "2026-03-10",
      }),
      pendingTxn({
        id: "p2",
        userId: USER,
        sourceType: "income_source",
        sourceId: "inc-2",
        occurrenceId: "inc-2_2026-03",
        scheduledDate: "2026-03-11",
      }),
    ]);

    await migratePendingToOverrides(USER);

    const sequence = store.__ops.map((op) => `${op.op}:${op.collection}`);
    expect(sequence).toEqual([
      "update:income_sources",
      "update:income_sources",
      "delete:transactions",
      "delete:transactions",
    ]);
  });

  it.fails(
    "KNOWN DEFECT: the override is written with notes: undefined, which real Firestore rejects",
    async () => {
      // migrations.ts:149-153 builds `{ scheduledDate, amount, notes: txn.notes }`
      // and hands it straight to setIncomeSourceOverride (incomeSources.ts:98),
      // which is the one write path in this repo that does NOT go through
      // removeUndefined (app/lib/firebase/firestore/utils.ts:10). A pending row
      // with no notes — the common case — therefore produces a nested map value of
      // `undefined`. The SDK is initialised without ignoreUndefinedProperties
      // (app/lib/firebase/config.ts:25), so in production updateDoc throws
      // "Unsupported field value: undefined" and the whole migration aborts,
      // leaving the remaining pending rows unconverted AND undeleted.
      // Correct behaviour: omit absent optional fields from the override.
      store.__seedEntities("income_sources", [makeIncomeSource({ id: "inc-1", userId: USER })]);
      store.__seedEntities("transactions", [
        pendingTxn({
          id: "pend-1",
          userId: USER,
          sourceType: "income_source",
          sourceId: "inc-1",
          occurrenceId: "inc-1_2026-03",
          scheduledDate: "2026-03-17",
          projectedAmount: 3_250,
          notes: undefined,
        }),
      ]);

      await migratePendingToOverrides(USER);

      const overrides = overridesOf("income_sources", "inc-1");
      expect(Object.keys(overrides)).toEqual(["inc-1_2026-03"]);
      const written = overrides["inc-1_2026-03"] as Record<string, unknown>;
      expect(Object.entries(written).filter(([, value]) => value === undefined)).toEqual([]);
    }
  );
});

// ============================================================================
// deleteProjectedTransactions
// ============================================================================

describe("deleteProjectedTransactions", () => {
  it("deletes only projected rows and returns how many", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "p1", userId: USER }),
      makeProjectedTransaction({ id: "p2", userId: USER, scheduledDate: "2026-02-15" }),
      makeCompletedTransaction({ id: "done", userId: USER }),
      makeSkippedTransaction({ id: "skip", userId: USER }),
      pendingTxn({ id: "pend", userId: USER }),
    ]);

    const deleted = await deleteProjectedTransactions(USER);

    expect(deleted).toBe(2);
    expect(idsIn("transactions")).toEqual(["done", "pend", "skip"]);
  });

  it("returns 0 and writes nothing when there is nothing projected", async () => {
    store.__seedEntities("transactions", [makeCompletedTransaction({ id: "done", userId: USER })]);

    const deleted = await deleteProjectedTransactions(USER);

    expect(deleted).toBe(0);
    expect(store.__ops).toHaveLength(0);
    expect(store.writeBatch.mock.calls).toHaveLength(0);
  });

  it("never deletes another user's projected rows", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "mine", userId: USER }),
      makeProjectedTransaction({ id: "theirs", userId: OTHER }),
    ]);

    const deleted = await deleteProjectedTransactions(USER);

    expect(deleted).toBe(1);
    expect(idsIn("transactions")).toEqual(["theirs"]);
  });

  it("chunks past the 500-operation batch limit", async () => {
    const rows = Array.from({ length: 501 }, (_, index) =>
      makeProjectedTransaction({ id: `p${index}`, userId: USER })
    );
    store.__seedEntities("transactions", rows);

    const deleted = await deleteProjectedTransactions(USER);

    expect(deleted).toBe(501);
    expect(store.__count("transactions")).toBe(0);
    expect(store.writeBatch.mock.calls).toHaveLength(2);
  });

  it("touches no other collection and does not reset the balance", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedOneOfEverything(USER, "a");
    store.__seedEntities("transactions", [makeProjectedTransaction({ id: "p1", userId: USER })]);

    await deleteProjectedTransactions(USER);

    expect(idsIn("income_sources")).toEqual(["inc-a"]);
    expect(idsIn("expense_rules")).toEqual(["exp-a"]);
    expect(idsIn("balance_history")).toEqual(["snap-a"]);
    expect(idsIn("alerts")).toEqual(["alert-a"]);
    expect(store.__opsFor("users")).toHaveLength(0);
    expect(rawProfile(USER).currentBalance).toBe(8_000);
  });
});

// ============================================================================
// deleteSelectiveUserData
// ============================================================================

describe("deleteSelectiveUserData", () => {
  const collectionsOtherThan = (type: DeletableDataType): DeletableDataType[] =>
    ALL_TYPES.filter((candidate) => candidate !== type);

  ALL_TYPES.forEach((type) => {
    it(`deletes only "${type}" when asked for that type alone`, async () => {
      seedProfile(USER, { currentBalance: 8_000 });
      seedOneOfEverything(USER, "a");
      seedOneOfEverything(OTHER, "b");

      await deleteSelectiveUserData(USER, [type]);

      expect(store.__all(type).map((row) => row.userId)).toEqual([OTHER]);
      collectionsOtherThan(type).forEach((survivor) => {
        expect(store.__count(survivor)).toBe(2);
      });
    });
  });

  it("deletes several types in one call", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedOneOfEverything(USER, "a");

    await deleteSelectiveUserData(USER, ["income_sources", "alerts"]);

    expect(store.__count("income_sources")).toBe(0);
    expect(store.__count("alerts")).toBe(0);
    expect(idsIn("expense_rules")).toEqual(["exp-a"]);
    expect(idsIn("transactions")).toEqual(["txn-a"]);
    expect(idsIn("balance_history")).toEqual(["snap-a"]);
  });

  it("de-duplicates repeated types instead of querying twice", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    store.__seedEntities("alerts", [makeAlert({ id: "alert-a", userId: USER })]);

    await deleteSelectiveUserData(USER, ["alerts", "alerts", "alerts"]);

    expect(store.__count("alerts")).toBe(0);
    // One getDocs for the single unique type — no balance reset in this path.
    expect(store.getDocs.mock.calls).toHaveLength(1);
  });

  it("is a no-op for an empty type list", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedOneOfEverything(USER, "a");

    await deleteSelectiveUserData(USER, []);

    expect(store.__ops).toHaveLength(0);
    ALL_TYPES.forEach((type) => expect(store.__count(type)).toBe(1));
    expect(rawProfile(USER).currentBalance).toBe(8_000);
  });

  it("resets the balance when transactions are deleted", async () => {
    seedProfile(USER, { currentBalance: 8_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");

    await deleteSelectiveUserData(USER, ["transactions"]);

    expect(rawProfile(USER).currentBalance).toBe(0);
    expect(rawProfile(USER).balanceLastUpdatedAt).toBe(TODAY);
  });

  it("resets the balance when balance history is deleted", async () => {
    seedProfile(USER, { currentBalance: 8_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");

    await deleteSelectiveUserData(USER, ["balance_history"]);

    expect(rawProfile(USER).currentBalance).toBe(0);
    expect(rawProfile(USER).balanceLastUpdatedAt).toBe(TODAY);
  });

  it("leaves the balance completely untouched for the other data types", async () => {
    seedProfile(USER, { currentBalance: 8_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");

    await deleteSelectiveUserData(USER, ["income_sources", "expense_rules", "alerts"]);

    expect(store.__opsFor("users")).toHaveLength(0);
    expect(rawProfile(USER).currentBalance).toBe(8_000);
    expect(rawProfile(USER).balanceLastUpdatedAt).toBe("2026-01-01");
  });

  it("never resets another user's balance", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedProfile(OTHER, { currentBalance: 4_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");
    seedOneOfEverything(OTHER, "b");
    const otherBefore = rawProfile(OTHER);

    await deleteSelectiveUserData(USER, ALL_TYPES);

    expect(rawProfile(OTHER)).toStrictEqual(otherBefore);
    ALL_TYPES.forEach((type) => {
      expect(store.__all(type).map((row) => row.userId)).toEqual([OTHER]);
    });
  });
});

// ============================================================================
// deleteAllUserData
// ============================================================================

describe("deleteAllUserData", () => {
  it("empties every financial collection for the user", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedOneOfEverything(USER, "a");
    store.__seedEntities("transactions", [
      makeCompletedTransaction({ id: "done", userId: USER }),
      makeProjectedTransaction({ id: "proj", userId: USER }),
    ]);

    await deleteAllUserData(USER);

    ALL_TYPES.forEach((type) => expect(store.__count(type)).toBe(0));
  });

  it("keeps the user profile document", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedOneOfEverything(USER, "a");

    await deleteAllUserData(USER);

    expect(store.__count("users")).toBe(1);
    expect(rawProfile(USER).email).toBe("test@example.com");
  });

  it("resets the balance to 0 and stamps today", async () => {
    seedProfile(USER, { currentBalance: 8_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");

    await deleteAllUserData(USER);

    expect(rawProfile(USER).currentBalance).toBe(0);
    expect(rawProfile(USER).balanceLastUpdatedAt).toBe(TODAY);
    expect(tsSeconds(rawProfile(USER).updatedAt)).toBe(secondsAt(TODAY));
  });

  it("still resets the balance for a user who has no data at all", async () => {
    seedProfile(USER, { currentBalance: 8_000 });

    await deleteAllUserData(USER);

    expect(rawProfile(USER).currentBalance).toBe(0);
    expect(store.__opsFor("users")).toHaveLength(1);
  });

  it("leaves another user's data and balance untouched", async () => {
    seedProfile(USER, { currentBalance: 8_000 });
    seedProfile(OTHER, { currentBalance: 4_000, balanceLastUpdatedAt: "2026-01-01" });
    seedOneOfEverything(USER, "a");
    seedOneOfEverything(OTHER, "b");
    const otherBefore = rawProfile(OTHER);

    await deleteAllUserData(USER);

    ALL_TYPES.forEach((type) => {
      expect(store.__all(type).map((row) => row.userId)).toEqual([OTHER]);
    });
    expect(idsIn("income_sources")).toEqual(["inc-b"]);
    expect(idsIn("transactions")).toEqual(["txn-b"]);
    expect(rawProfile(OTHER)).toStrictEqual(otherBefore);
    expect(store.__opsFor("users").map((op) => op.id)).toEqual([USER]);
  });

  it.fails(
    "KNOWN DEFECT: initialBalance survives the wipe, so the computed balance resurrects the deleted money",
    async () => {
      // migrations.ts:94 resets currentBalance to 0 but never touches
      // initialBalance. computeBalanceFromTransactions (computedBalance.ts:16) is
      // the app's declared source of truth and is fed profile.initialBalance by
      // BalanceSection.tsx:62 and syncComputedBalance (computedBalance.ts:50).
      // With every transaction deleted it returns initialBalance — 8_000 — while
      // the stored balance says 0.
      // Correct behaviour (asserted as the invariant so either fix satisfies it):
      // the stored balance and the computed balance must agree after the wipe.
      // The intended fix is to reset initialBalance to 0 alongside currentBalance.
      // Consequence as written: the settings page shows a phantom 8_000
      // discrepancy immediately after "delete all data", and one sync restores
      // 8_000 out of nothing.
      seedProfile(USER, { currentBalance: 8_000, initialBalance: 8_000 });
      seedOneOfEverything(USER, "a");

      await deleteAllUserData(USER);

      const profile = await getUserProfile(USER);
      expect(profile).not.toBeNull();
      expect(computeBalanceFromTransactions(profile!.initialBalance, [])).toBe(
        profile!.currentBalance
      );
    }
  );
});

// ============================================================================
// normalizePartialTransactions
//
// Exported by migrations.ts but NOT re-exported from
// app/lib/firebase/firestore/index.ts, and nothing in app/ calls it — it is
// reachable only via a direct module import.
// ============================================================================

describe("normalizePartialTransactions", () => {
  it("writes nothing when there are no partial rows", async () => {
    store.__seedEntities("transactions", [
      makeProjectedTransaction({ id: "p1", userId: USER }),
      makeCompletedTransaction({ id: "c1", userId: USER }),
    ]);

    await normalizePartialTransactions(USER);

    expect(store.__ops).toHaveLength(0);
    expect(idsIn("transactions")).toEqual(["c1", "p1"]);
  });

  it("reclassifies a partial row to projected and clears the recorded actual", async () => {
    store.__seedEntities("transactions", [
      partialTxn({
        id: "part-1",
        userId: USER,
        projectedAmount: 1_200,
        actualAmount: 500,
        actualDate: "2026-03-04",
        notes: "paid half",
      }),
    ]);

    await normalizePartialTransactions(USER);

    const row = store.__get<LegacyTransaction>("transactions", "part-1");
    expect(row).toBeDefined();
    expect(row?.status).toBe("projected");
    expect(row?.projectedAmount).toBe(1_200);
    expect(row?.actualAmount ?? null).toBeNull();
    expect(row?.actualDate ?? null).toBeNull();
    expect(row?.notes ?? null).toBeNull();
  });

  it("refreshes updatedAt", async () => {
    store.__seedEntities("transactions", [partialTxn({ id: "part-1", userId: USER })]);

    await normalizePartialTransactions(USER);

    const row = store.__get<LegacyTransaction>("transactions", "part-1");
    expect(row).toBeDefined();
    expect(tsSeconds(row?.updatedAt)).toBe(secondsAt(TODAY));
  });

  it("deletes the remainder children linked to a partial parent", async () => {
    store.__seedEntities("transactions", [
      partialTxn({ id: "part-1", userId: USER, projectedAmount: 1_200, actualAmount: 500 }),
      childTxn({
        id: "remainder-1",
        userId: USER,
        projectedAmount: 700,
        parentTransactionId: "part-1",
      }),
    ]);

    await normalizePartialTransactions(USER);

    expect(idsIn("transactions")).toEqual(["part-1"]);
  });

  it("leaves children of unrelated parents in place", async () => {
    store.__seedEntities("transactions", [
      partialTxn({ id: "part-1", userId: USER }),
      childTxn({
        id: "remainder-other",
        userId: USER,
        parentTransactionId: "some-other-txn",
      }),
    ]);

    await normalizePartialTransactions(USER);

    expect(idsIn("transactions")).toEqual(["part-1", "remainder-other"]);
  });

  it("leaves projected, completed and skipped rows untouched", async () => {
    store.__seedEntities("transactions", [
      partialTxn({ id: "part-1", userId: USER }),
      makeProjectedTransaction({ id: "proj", userId: USER }),
      makeCompletedTransaction({ id: "done", userId: USER, actualAmount: 90, notes: "keep me" }),
      makeSkippedTransaction({ id: "skip", userId: USER }),
    ]);

    await normalizePartialTransactions(USER);

    expect(idsIn("transactions")).toEqual(["done", "part-1", "proj", "skip"]);
    const done = store.__get<Transaction>("transactions", "done");
    expect(done?.status).toBe("completed");
    expect(done?.actualAmount).toBe(90);
    expect(done?.notes).toBe("keep me");
  });

  it("never touches another user's partial rows or their remainder children", async () => {
    store.__seedEntities("transactions", [
      partialTxn({ id: "mine", userId: USER, actualAmount: 400 }),
      partialTxn({ id: "theirs", userId: OTHER, actualAmount: 400, notes: "their note" }),
      // Same parent id as the migrated user's partial, but a different owner:
      // the remainder query filters on userId, so this must survive.
      childTxn({ id: "their-child", userId: OTHER, parentTransactionId: "mine" }),
    ]);

    await normalizePartialTransactions(USER);

    expect(idsIn("transactions")).toEqual(["mine", "their-child", "theirs"]);
    const theirs = store.__get<LegacyTransaction>("transactions", "theirs");
    expect(theirs?.status).toBe("partial");
    expect(theirs?.notes).toBe("their note");
  });

  it("chunks the parent-id lookup past the 10-value 'in' limit", async () => {
    const parents = Array.from({ length: 12 }, (_, index) =>
      partialTxn({ id: `part-${index}`, userId: USER, actualAmount: 100 })
    );
    const children = Array.from({ length: 12 }, (_, index) =>
      childTxn({
        id: `child-${index}`,
        userId: USER,
        parentTransactionId: `part-${index}`,
      })
    );
    store.__seedEntities("transactions", [...parents, ...children]);

    await normalizePartialTransactions(USER);

    expect(store.__count("transactions")).toBe(12);
    const remaining = store.__all<LegacyTransaction>("transactions");
    expect(remaining.filter((row) => row.status === "projected")).toHaveLength(12);
    expect(remaining.filter((row) => row.id.startsWith("child-"))).toEqual([]);
  });

  it.fails(
    "KNOWN DEFECT: a stale variance survives the reclassification to projected",
    async () => {
      // migrations.ts:254-260 clears actualAmount/actualDate/notes but leaves
      // `variance` (and `completedAt`) on the document. A projected row has no
      // recorded actual, so a variance is meaningless — yet
      // app/components/pages/transactions/components/TransactionRow.tsx:19 keys its
      // variance badge purely off `transaction.variance !== 0` and will render
      // "-700.00 variance" against a transaction that has not been paid at all.
      // Correct behaviour: variance is cleared along with the actual it describes.
      store.__seedEntities("transactions", [
        partialTxn({
          id: "part-1",
          userId: USER,
          projectedAmount: 1_200,
          actualAmount: 500,
          variance: -700,
          notes: "paid half",
        }),
      ]);

      await normalizePartialTransactions(USER);

      const row = store.__get<LegacyTransaction>("transactions", "part-1");
      expect(row).toBeDefined();
      expect(row?.status).toBe("projected");
      expect(row?.variance ?? 0).toBe(0);
    }
  );
});
