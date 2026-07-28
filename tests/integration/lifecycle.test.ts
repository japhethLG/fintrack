import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type {
  BillCoverageReport,
  DayBalance,
  ExpenseRule,
  IncomeSource,
  Transaction,
  UserProfile,
} from "@/lib/types";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import {
  calculateDailyBalances,
  calculateMonthlyTotals,
  calculateVarianceReport,
  getBillCoverageReport,
} from "@/lib/logic/balanceCalculator";
import {
  markTransactionCompleteAction,
  markTransactionSkippedAction,
  rescheduleTransactionAction,
  revertTransactionToProjectedAction,
} from "@/contexts/FinancialContext/actions/transactionActions";
import { completeTransaction } from "@/lib/firebase/firestore/transactions";
import * as store from "../helpers/firestoreEmulator";
import {
  cents,
  makeExpenseRule,
  makeIncomeSource,
  makeLoanRule,
  makeUserProfile,
} from "../helpers/builders";
import { d, daysBetween, duplicates } from "../helpers/dates";
import { freezeToday } from "../helpers/time";

/**
 * THEME: the whole life of one occurrence, seen the way the user sees it.
 *
 * The unit suites pin individual functions. This suite pins the STORY: a bill
 * is projected, paid, mis-paid, corrected, moved, undone, skipped,
 * rescheduled — and after every step the DERIVED VIEW (merged list + daily
 * balance map + bill coverage) is re-computed from real persisted state and
 * asserted end to end.
 *
 * Fidelity rules that make these tests meaningful:
 *   - every mutation goes through the real action layer
 *     (`app/contexts/FinancialContext/actions/transactionActions.ts`), which
 *     writes through the real firestore repo into the in-memory emulator;
 *   - nothing is hand-built between steps: `readWorld()` re-reads the profile,
 *     the stored transactions, the income sources and the expense rules out of
 *     the emulator, so each assertion observes what was actually persisted;
 *   - `derive()` reproduces the context's order of operations exactly —
 *     merge (FinancialContext/index.tsx:85-97), then daily balances, then bill
 *     coverage (useComputedFinancials.ts:18-45).
 *
 * The single most load-bearing invariant is the double-count guard, asserted
 * automatically by `snapshot()` on every derived view in every scenario: a
 * realized row must DISPLACE its projection, never sit beside it.
 */

// ============================================================================
// LOCAL HELPERS
//
// Gaps in tests/helpers/* covered here:
//   - there is no helper that reproduces the context's derivation pipeline
//     (merge -> daily balances -> bill coverage), which is the whole subject of
//     this file;
//   - there is no helper for reading the persisted world back out of the
//     emulator as the subscriptions would deliver it;
//   - `makeUserProfile` returns a typed UserProfile, but `store.__seed` wants a
//     plain record, so seeding needs a cast.
// ============================================================================

const USER = "user-1";

interface Window {
  start: string;
  end: string;
}

interface World {
  profile: UserProfile;
  stored: Transaction[];
  sources: IncomeSource[];
  rules: ExpenseRule[];
}

interface DerivedView {
  transactions: Transaction[];
  daily: Map<string, DayBalance>;
  coverage: BillCoverageReport;
}

/** The three-month window every non-loan scenario is viewed through. */
const WINDOW: Window = { start: "2026-01-01", end: "2026-03-31" };

/** The six days in WINDOW that carry money, in order. */
const EVENT_DAYS = [
  "2026-01-01",
  "2026-01-05",
  "2026-02-01",
  "2026-02-05",
  "2026-03-01",
  "2026-03-05",
];

/**
 * Closing balances on EVENT_DAYS for the untouched projection: balance 2000,
 * salary +3000 on the 1st, rent -1200 on the 5th.
 */
const BASELINE_CLOSINGS = [5000, 3800, 6800, 5600, 8600, 7400];

const SALARY_IDS = [
  "proj_inc-1::2026-01-01::inc-1_2026-01",
  "proj_inc-1::2026-02-01::inc-1_2026-02",
  "proj_inc-1::2026-03-01::inc-1_2026-03",
];
const JAN_RENT_ID = "proj_exp-1::2026-01-05::exp-1_2026-01";
const FEB_RENT_ID = "proj_exp-1::2026-02-05::exp-1_2026-02";
const MAR_RENT_ID = "proj_exp-1::2026-03-05::exp-1_2026-03";

const salaryRule = (): IncomeSource =>
  makeIncomeSource({ id: "inc-1", name: "Salary", amount: 3_000, startDate: "2026-01-01" });

const rentRule = (): ExpenseRule =>
  makeExpenseRule({ id: "exp-1", name: "Rent", amount: 1_200, startDate: "2026-01-05" });

/** Seed the user, one monthly income source and one monthly expense rule. */
const seedWorld = (currentBalance = 2_000): void => {
  store.__seed(
    "users",
    USER,
    makeUserProfile({ uid: USER, currentBalance }) as unknown as Record<string, unknown>
  );
  store.__seedEntities("income_sources", [salaryRule()]);
  store.__seedEntities("expense_rules", [rentRule()]);
};

/**
 * Read the whole world back out of the emulator.
 *
 * The stored-transaction filter mirrors `subscribeToStoredTransactions`
 * (transactions.ts:364-366): rule-based projected rows are never read back,
 * they are regenerated by the merger.
 */
const readWorld = (): World => {
  const profile = store.__get<UserProfile>("users", USER);
  if (!profile) throw new Error("expected users/user-1 to be seeded");
  return {
    profile,
    stored: (store.__all<Transaction>("transactions") as Transaction[]).filter(
      (t) => t.sourceType === "manual" || t.status === "completed" || t.status === "skipped"
    ),
    sources: store.__all<IncomeSource>("income_sources") as IncomeSource[],
    rules: store.__all<ExpenseRule>("expense_rules") as ExpenseRule[],
  };
};

/** The context's derivation pipeline: merge, then daily balances, then coverage. */
const derive = (world: World, window: Window, daysAhead = 14): DerivedView => {
  const transactions = mergeTransactionsWithProjections(
    world.stored,
    world.sources,
    world.rules,
    window,
    world.profile.uid
  );
  return {
    transactions,
    daily: calculateDailyBalances(
      world.profile.currentBalance,
      transactions,
      d(window.start),
      d(window.end),
      world.profile.preferences.defaultWarningThreshold
    ),
    coverage: getBillCoverageReport(world.profile.currentBalance, transactions, daysAhead),
  };
};

/** The amount a view actually spends for a row — actual once realized. */
const effective = (t: Transaction): number =>
  t.status === "completed" ? (t.actualAmount ?? t.projectedAmount) : t.projectedAmount;

/**
 * The double-count guard, plus the internal consistency of the balance map.
 *
 * Asserted on EVERY derived view in EVERY scenario (see `snapshot`) because
 * both failure modes it catches are silent and catastrophic: a projection left
 * beside its realized row double-spends the user's money, and a day whose
 * totals disagree with its own row list makes the calendar lie about itself.
 */
const assertViewIsConsistent = (view: DerivedView, window: Window): void => {
  const { transactions, daily } = view;

  // No row is emitted twice.
  expect(duplicates(transactions.map((t) => t.id))).toEqual([]);

  // No `proj_` row survives alongside a stored row for the same occurrence.
  const realizedOccurrences = new Set(
    transactions
      .filter((t) => !t.id.startsWith("proj_"))
      .map((t) => t.occurrenceId)
      .filter((id): id is string => !!id)
  );
  const doubleCounted = transactions
    .filter((t) => t.id.startsWith("proj_") && t.occurrenceId)
    .filter((t) => realizedOccurrences.has(t.occurrenceId as string))
    .map((t) => t.id);
  expect(doubleCounted).toEqual([]);

  // Every day's totals are recomputable from that day's own row list, the
  // closing balance follows from them, and the days chain opening->closing.
  let previousClosing: number | null = null;
  daysBetween(window.start, window.end).forEach((day) => {
    const balance = daily.get(day);
    expect(balance, `no DayBalance for ${day}`).toBeDefined();
    // summed raw, not rounded: an invariant must not launder float noise away
    const rows = balance!.transactions.filter((t) => t.status !== "skipped");
    const sum = (type: Transaction["type"]) =>
      rows.filter((t) => t.type === type).reduce((total, t) => total + effective(t), 0);
    const income = sum("income");
    const expenses = sum("expense");

    expect(balance!.totalIncome).toBeCloseTo(income, 6);
    expect(balance!.totalExpenses).toBeCloseTo(expenses, 6);
    expect(balance!.closingBalance).toBeCloseTo(balance!.openingBalance + income - expenses, 6);
    if (previousClosing !== null) {
      expect(balance!.openingBalance).toBeCloseTo(previousClosing, 6);
    }
    previousClosing = balance!.closingBalance;
  });

  // Every merged row dated inside the window lands in exactly one day bucket.
  const bucketed = daysBetween(window.start, window.end)
    .flatMap((day) => daily.get(day)!.transactions)
    .map((t) => t.id)
    .sort();
  const insideWindow = transactions
    .filter((t) => {
      const key = t.actualDate || t.scheduledDate;
      return key >= window.start && key <= window.end;
    })
    .map((t) => t.id)
    .sort();
  expect(bucketed).toEqual(insideWindow);
};

/** Re-read persisted state, re-derive the view, and guard the invariant. */
const snapshot = (window: Window = WINDOW, daysAhead = 14): DerivedView => {
  const view = derive(readWorld(), window, daysAhead);
  assertViewIsConsistent(view, window);
  return view;
};

/** The date each merged row is filed under, in list order. */
const dates = (transactions: Transaction[]): string[] =>
  transactions.map((t) => t.actualDate || t.scheduledDate);

/** Closing balances for the given days, rounded to cents. */
const closings = (view: DerivedView, days: string[] = EVENT_DAYS): number[] =>
  days.map((day) => cents(view.daily.get(day)!.closingBalance));

/** The merged row filed under a given date (there is exactly one per day here). */
const rowOn = (view: DerivedView, day: string): Transaction => {
  const found = view.transactions.filter((t) => (t.actualDate || t.scheduledDate) === day);
  if (found.length !== 1)
    throw new Error(`expected exactly one row on ${day}, got ${found.length}`);
  return found[0];
};

/** Persisted balance, read straight out of the store. */
const balance = (): number => store.__get<UserProfile>("users", USER)!.currentBalance;

/** The one stored transaction, failing loudly if there is not exactly one. */
const onlyStoredRow = (): Transaction => {
  const rows = store.__all<Transaction>("transactions") as Transaction[];
  if (rows.length !== 1) throw new Error(`expected exactly one stored row, got ${rows.length}`);
  return rows[0];
};

const storedRule = (id: string): ExpenseRule => {
  const found = store.__get<ExpenseRule>("expense_rules", id);
  if (!found) throw new Error(`expected expense_rules/${id} to exist`);
  return { ...found, id } as ExpenseRule;
};

/** Rules/sources as the action layer receives them (from the live subscription). */
const liveRules = (): ExpenseRule[] => store.__all<ExpenseRule>("expense_rules") as ExpenseRule[];
const liveSources = (): IncomeSource[] =>
  store.__all<IncomeSource>("income_sources") as IncomeSource[];

const completeOccurrence = (id: string, actualAmount: number, actualDate?: string) =>
  markTransactionCompleteAction(id, { actualAmount, actualDate }, USER, liveSources(), liveRules());

beforeEach(() => {
  store.__reset();
});

// ============================================================================
// 1. HAPPY PATH
// ============================================================================

describe("happy path: project, then pay exactly what was projected", () => {
  beforeEach(() => {
    freezeToday("2026-01-02");
    seedWorld(2_000);
  });

  it("projects every occurrence of both schedules across the window before anything is paid", () => {
    const view = snapshot();

    // 3 salary occurrences (1st) + 3 rent occurrences (5th), nothing stored yet
    expect(view.transactions).toHaveLength(6);
    expect(store.__count("transactions")).toBe(0);
    expect(view.transactions.map((t) => t.id)).toEqual([
      SALARY_IDS[0],
      JAN_RENT_ID,
      SALARY_IDS[1],
      FEB_RENT_ID,
      SALARY_IDS[2],
      MAR_RENT_ID,
    ]);
    expect(dates(view.transactions)).toEqual(EVENT_DAYS);
    expect(view.transactions.every((t) => t.status === "projected")).toBe(true);
  });

  it("walks the balance down the window: 2000 opening, 7400 by the end of March", () => {
    const view = snapshot();

    expect(closings(view)).toEqual(BASELINE_CLOSINGS);
    // nothing happens after 2026-03-05, so the window closes where it left off
    expect(cents(view.daily.get("2026-03-31")!.closingBalance)).toBe(7_400);
    expect(view.daily.get("2026-01-01")!.openingBalance).toBe(2_000);
  });

  it("replaces the projection with the realized row instead of adding to it", async () => {
    const before = snapshot();

    await completeOccurrence(JAN_RENT_ID, 1_200);

    const after = snapshot();
    // the count is the assertion: 6 before, 6 after — the stored row DISPLACED
    // its projection rather than joining it
    expect(after.transactions).toHaveLength(before.transactions.length);
    expect(dates(after.transactions)).toEqual(EVENT_DAYS);
    expect(after.transactions.map((t) => t.id.startsWith("proj_"))).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(rowOn(after, "2026-01-05").status).toBe("completed");
    expect(rowOn(after, "2026-01-05").occurrenceId).toBe("exp-1_2026-01");
  });

  it("takes the money out of the persisted balance exactly once", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_200);

    expect(balance()).toBe(800);
    const stored = onlyStoredRow();
    expect(stored.actualAmount).toBe(1_200);
    expect(stored.projectedAmount).toBe(1_200);
    expect(stored.actualDate).toBe("2026-01-05");
    expect(stored.scheduledDate).toBe("2026-01-05");
  });

  it("leaves every derived closing balance untouched when the actual equals the projection", async () => {
    const before = snapshot();

    await completeOccurrence(JAN_RENT_ID, 1_200);

    // currentBalance is now 800, but calculateDailyBalances undoes completed
    // rows to recover the 2000 opening, so the whole curve is NET unchanged
    const after = snapshot();
    expect(closings(after)).toEqual(closings(before));
    expect(closings(after)).toEqual(BASELINE_CLOSINGS);
    expect(after.daily.get("2026-01-01")!.openingBalance).toBe(2_000);
  });
});

// ============================================================================
// 2. ACTUAL DIFFERS FROM PROJECTED
// ============================================================================

describe("overspend: the actual comes in above the projection", () => {
  beforeEach(() => {
    freezeToday("2026-01-02");
    seedWorld(2_000);
  });

  it("shows the actual, not the projection, in the day's expense total", async () => {
    const before = snapshot();
    expect(before.daily.get("2026-01-05")!.totalExpenses).toBe(1_200);

    await completeOccurrence(JAN_RENT_ID, 1_350);

    const after = snapshot();
    expect(after.daily.get("2026-01-05")!.totalExpenses).toBe(1_350);
    expect(rowOn(after, "2026-01-05").actualAmount).toBe(1_350);
  });

  it("pushes every closing balance from that day forward down by the overspend", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);

    const after = snapshot();
    // 150 overspend: the 2026-01-01 salary day is untouched, everything from
    // 2026-01-05 onward is exactly 150 lower
    expect(closings(after)).toEqual([5_000, 3_650, 6_650, 5_450, 8_450, 7_250]);
    expect(cents(after.daily.get("2026-03-31")!.closingBalance)).toBe(7_250);
    expect(balance()).toBe(650);
  });

  it("reports the overspend as expense variance for the scheduled month", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);

    const report = calculateVarianceReport(snapshot().transactions, "2026-01-01", "2026-01-31");
    expect(report.expenses.projected).toBe(1_200);
    expect(report.expenses.actual).toBe(1_350);
    expect(report.expenses.variance).toBe(150);
    // 150 / 1200 = 12.5%
    expect(report.expenses.variancePercent).toBeCloseTo(12.5, 6);
    expect(report.byCategory).toEqual([
      { category: "housing", projected: 1_200, actual: 1_350, variance: 150 },
    ]);
  });

  it("attributes nothing to income variance, since the salary is still only projected", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);

    const report = calculateVarianceReport(snapshot().transactions, "2026-01-01", "2026-01-31");
    expect(report.income).toEqual({ projected: 0, actual: 0, variance: 0, variancePercent: 0 });
  });

  describe("known defects", () => {
    /**
     * DEFECT: `markTransactionCompleteAction` builds the realized row with
     * `addTransaction` (transactionActions.ts:89-110) and never computes
     * `variance`, unlike `completeTransaction` (transactions.ts:166) which does.
     * A first-time completion of a projected occurrence therefore persists no
     * variance at all, so `TransactionRow.tsx:19` (`transaction.variance &&
     * transaction.variance !== 0`) never renders the over/under badge — the
     * field only materializes if the user edits the actual a second time.
     * CORRECT: the stored row must carry variance = 1350 - 1200 = 150.
     */
    it.fails("KNOWN DEFECT: persists the variance on a first-time completion", async () => {
      await completeOccurrence(JAN_RENT_ID, 1_350);

      expect(onlyStoredRow().variance).toBe(150);
    });
  });
});

// ============================================================================
// 3. THE ACTUAL IS THEN CORRECTED
// ============================================================================

describe("correction: the recorded actual is edited, then moved to another day", () => {
  beforeEach(async () => {
    freezeToday("2026-01-02");
    seedWorld(2_000);
    // the user first records 1350...
    await completeOccurrence(JAN_RENT_ID, 1_350);
  });

  it("moves the balance by the delta from the previous actual, not by a fresh deduction", async () => {
    expect(balance()).toBe(650);

    // ...then corrects it to 1100 — the row is now STORED, so this goes through
    // completeTransaction's reversal path, not the projection path
    await completeOccurrence(onlyStoredRow().id, 1_100);

    // 650 + 1350 (reversal) - 1100 = 900, i.e. 2000 - 1100. A fresh 1100
    // deduction with no reversal would have left 650 - 1100 = -450.
    expect(balance()).toBe(900);
  });

  it("measures variance against the ORIGINAL projection, not against the old actual", async () => {
    await completeOccurrence(onlyStoredRow().id, 1_100);

    const stored = onlyStoredRow();
    expect(stored.projectedAmount).toBe(1_200);
    expect(stored.actualAmount).toBe(1_100);
    // 1100 - 1200 = -100 (underspend), never 1100 - 1350
    expect(stored.variance).toBe(-100);
  });

  it("re-derives the whole curve from the corrected actual", async () => {
    await completeOccurrence(onlyStoredRow().id, 1_100);

    const view = snapshot();
    // 100 underspend against the 1200 projection: every day from 2026-01-05 is
    // 100 HIGHER than the baseline
    expect(closings(view)).toEqual([5_000, 3_900, 6_900, 5_700, 8_700, 7_500]);
    expect(view.daily.get("2026-01-05")!.totalExpenses).toBe(1_100);
    expect(view.transactions).toHaveLength(6);
  });

  it("moves the expense to the day it was actually paid, leaving the schedule alone", async () => {
    await completeOccurrence(onlyStoredRow().id, 1_100);
    // paid three days late: 2026-01-05 scheduled, 2026-01-08 actual
    await completeOccurrence(onlyStoredRow().id, 1_100, "2026-01-08");

    const stored = onlyStoredRow();
    expect(stored.actualDate).toBe("2026-01-08");
    // the schedule is a statement about the obligation and is never rewritten
    expect(stored.scheduledDate).toBe("2026-01-05");
    expect(stored.occurrenceId).toBe("exp-1_2026-01");

    const view = snapshot();
    // gone from the scheduled day...
    expect(view.daily.get("2026-01-05")!.totalExpenses).toBe(0);
    expect(view.daily.get("2026-01-05")!.transactions).toEqual([]);
    expect(cents(view.daily.get("2026-01-05")!.closingBalance)).toBe(5_000);
    // ...and present on the day the money left
    expect(view.daily.get("2026-01-08")!.totalExpenses).toBe(1_100);
    expect(cents(view.daily.get("2026-01-08")!.closingBalance)).toBe(3_900);
    expect(dates(view.transactions)).toEqual([
      "2026-01-01",
      "2026-01-08",
      "2026-02-01",
      "2026-02-05",
      "2026-03-01",
      "2026-03-05",
    ]);
  });

  it("does not move the balance when only the actual date changes", async () => {
    await completeOccurrence(onlyStoredRow().id, 1_100);
    expect(balance()).toBe(900);

    await completeOccurrence(onlyStoredRow().id, 1_100, "2026-01-08");

    // reverse 1100, re-apply 1100 — a net zero movement
    expect(balance()).toBe(900);
  });

  it("still displaces the projection after the actual date has moved off the schedule", async () => {
    await completeOccurrence(onlyStoredRow().id, 1_100, "2026-01-08");

    const view = snapshot();
    // the merge key is the occurrenceId, not the date, so a row paid on a
    // different day than scheduled still displaces its own projection
    expect(view.transactions).toHaveLength(6);
    expect(view.transactions.filter((t) => t.occurrenceId === "exp-1_2026-01")).toHaveLength(1);
  });
});

// ============================================================================
// 4. UNDO
// ============================================================================

describe("undo: reverting a realized occurrence back to projected", () => {
  beforeEach(() => {
    freezeToday("2026-01-02");
    seedWorld(2_000);
  });

  it("restores the exact pre-completion view after a full complete/correct/move/undo round trip", async () => {
    const before = snapshot();

    await completeOccurrence(JAN_RENT_ID, 1_350);
    await completeOccurrence(onlyStoredRow().id, 1_100);
    await completeOccurrence(onlyStoredRow().id, 1_100, "2026-01-08");
    await revertTransactionToProjectedAction(onlyStoredRow().id);

    const after = snapshot();
    // the strongest single assertion in the suite: any value that fails to come
    // back is a leak somewhere in the mutation chain
    expect(store.__count("transactions")).toBe(0);
    expect(balance()).toBe(2_000);
    expect(after.transactions.map((t) => t.id)).toEqual(before.transactions.map((t) => t.id));
    expect(dates(after.transactions)).toEqual(EVENT_DAYS);
    expect(closings(after)).toEqual(BASELINE_CLOSINGS);
    expect(closings(after)).toEqual(closings(before));
  });

  it("brings the occurrence back as a projection with the same occurrenceId and id", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    await revertTransactionToProjectedAction(onlyStoredRow().id);

    const view = snapshot();
    const rent = rowOn(view, "2026-01-05");
    expect(rent.id).toBe(JAN_RENT_ID);
    expect(rent.occurrenceId).toBe("exp-1_2026-01");
    expect(rent.status).toBe("projected");
    expect(rent.projectedAmount).toBe(1_200);
    // nothing lingers from the realized row
    expect(rent.actualAmount).toBeUndefined();
    expect(rent.actualDate).toBeUndefined();
  });

  it("writes no date override when the occurrence sat on its pattern date", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    await revertTransactionToProjectedAction(onlyStoredRow().id);

    // getExpectedDateFromOccurrenceId reconstructs 2026-01-05 from
    // "exp-1_2026-01" + startDate day 5, so no override is needed
    expect(storedRule("exp-1").occurrenceOverrides).toEqual({});
  });

  it("restores the balance even when the actual differed from the projection", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    expect(balance()).toBe(650);

    await revertTransactionToProjectedAction(onlyStoredRow().id);

    // the full 1350 is given back, not the 1200 that was projected
    expect(balance()).toBe(2_000);
  });
});

// ============================================================================
// 5. SKIP
// ============================================================================

describe("skip: an occurrence the user declares will not happen", () => {
  const skipFebruaryRent = () =>
    markTransactionSkippedAction(FEB_RENT_ID, "moved out", USER, liveSources(), liveRules());

  describe("seen from January", () => {
    beforeEach(async () => {
      freezeToday("2026-01-02");
      seedWorld(2_000);
      await skipFebruaryRent();
    });

    it("keeps the occurrence visible as skipped rather than dropping it", () => {
      const view = snapshot();

      // the user must still see that February's rent exists and was skipped
      expect(view.transactions).toHaveLength(6);
      expect(dates(view.transactions)).toEqual(EVENT_DAYS);
      const feb = rowOn(view, "2026-02-05");
      expect(feb.status).toBe("skipped");
      expect(feb.occurrenceId).toBe("exp-1_2026-02");
      expect(feb.projectedAmount).toBe(1_200);
      expect(feb.notes).toBe("moved out");
      expect(feb.id.startsWith("proj_")).toBe(false);
    });

    it("does not touch the balance", () => {
      expect(balance()).toBe(2_000);
      expect(store.__opsFor("users")).toEqual([]);
    });

    it("spends nothing on the skipped day", () => {
      const view = snapshot();

      expect(view.daily.get("2026-02-05")!.totalExpenses).toBe(0);
      // the row is still filed under the day, it just contributes zero
      expect(view.daily.get("2026-02-05")!.transactions).toHaveLength(1);
      expect(cents(view.daily.get("2026-02-05")!.closingBalance)).toBe(6_800);
    });

    it("lifts every closing balance from the skipped day forward by the skipped amount", () => {
      const view = snapshot();

      expect(closings(view)).toEqual([5_000, 3_800, 6_800, 6_800, 9_800, 8_600]);
      // exactly 1200 higher than the baseline from 2026-02-05 onward
      expect(closings(view).slice(3)).toEqual(BASELINE_CLOSINGS.slice(3).map((v) => v + 1_200));
    });
  });

  describe("seen from the day the 14-day coverage window opens", () => {
    beforeEach(async () => {
      // 2026-02-01 + 14 days spans the skipped 2026-02-05 rent
      freezeToday("2026-02-01");
      seedWorld(2_000);
      await skipFebruaryRent();
    });

    it("keeps a skipped occurrence out of the bill coverage report", () => {
      const view = snapshot();

      expect(view.coverage.upcomingBills).toEqual([]);
      expect(view.coverage.totalUpcoming).toBe(0);
      expect(view.coverage.canCoverAll).toBe(true);
      // only the salary lands in the window, so the projection improves
      expect(view.coverage.projectedBalance).toBe(5_000);
    });
  });
});

// ============================================================================
// 6. RESCHEDULE
// ============================================================================

describe("reschedule: dragging an occurrence to a different day", () => {
  /** A one-off bill between the old and new rent dates, so ordering is visible. */
  const insuranceRule = (): ExpenseRule =>
    makeExpenseRule({
      id: "ins-1",
      name: "Insurance",
      category: "insurance",
      amount: 300,
      frequency: "one-time",
      startDate: "2026-03-10",
    });

  beforeEach(() => {
    freezeToday("2026-03-01");
    seedWorld(2_000);
    store.__seedEntities("expense_rules", [insuranceRule()]);
  });

  it("persists the new date as an override on the RULE, creating no transaction", async () => {
    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    expect(storedRule("exp-1").occurrenceOverrides).toEqual({
      "exp-1_2026-03": { scheduledDate: "2026-03-20" },
    });
    // a reschedule is a change to the SCHEDULE, not a realized event
    expect(store.__count("transactions")).toBe(0);
  });

  it("moves the projection's scheduled date while keeping its occurrenceId", async () => {
    const before = snapshot();
    expect(rowOn(before, "2026-03-05").occurrenceId).toBe("exp-1_2026-03");

    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    const after = snapshot();
    expect(dates(after.transactions)).toEqual([
      "2026-01-01",
      "2026-01-05",
      "2026-02-01",
      "2026-02-05",
      "2026-03-01",
      "2026-03-10",
      "2026-03-20",
    ]);
    const rent = rowOn(after, "2026-03-20");
    expect(rent.scheduledDate).toBe("2026-03-20");
    // same logical month, so the occurrence identity survives the move
    expect(rent.occurrenceId).toBe("exp-1_2026-03");
    expect(rent.id).toBe("proj_exp-1::2026-03-20::exp-1_2026-03");
  });

  it("moves the dip in the daily balance map to the new day", async () => {
    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    const view = snapshot();
    // 2000 + 3000 - 1200 (Jan) + 3000 - 1200 (Feb) + 3000 = 8600 on 2026-03-01,
    // then -300 insurance on the 10th, then -1200 rent on the 20th
    expect(view.daily.get("2026-03-05")!.totalExpenses).toBe(0);
    expect(cents(view.daily.get("2026-03-05")!.closingBalance)).toBe(8_600);
    expect(cents(view.daily.get("2026-03-10")!.closingBalance)).toBe(8_300);
    expect(view.daily.get("2026-03-20")!.totalExpenses).toBe(1_200);
    expect(cents(view.daily.get("2026-03-20")!.closingBalance)).toBe(7_100);
    // the window still closes in the same place — money moved days, not amount
    expect(cents(view.daily.get("2026-03-31")!.closingBalance)).toBe(7_100);
  });

  it("reorders the bill coverage report around the moved bill", async () => {
    // 30 days from 2026-03-01 spans both the old and the new rent date
    const before = snapshot(WINDOW, 30);
    expect(before.coverage.upcomingBills.map((b) => [b.transaction.name, b.daysUntilDue])).toEqual([
      ["Rent", 4],
      ["Insurance", 9],
    ]);

    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    const after = snapshot(WINDOW, 30);
    expect(after.coverage.upcomingBills.map((b) => [b.transaction.name, b.daysUntilDue])).toEqual([
      ["Insurance", 9],
      ["Rent", 19],
    ]);
    expect(after.coverage.totalUpcoming).toBe(1_500);
    expect(after.coverage.canCoverAll).toBe(true);
  });

  it("records the realized row on the overridden date and clears the override", async () => {
    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    await completeOccurrence("proj_exp-1::2026-03-20::exp-1_2026-03", 1_200);

    const stored = onlyStoredRow();
    expect(stored.scheduledDate).toBe("2026-03-20");
    expect(stored.actualDate).toBe("2026-03-20");
    expect(stored.occurrenceId).toBe("exp-1_2026-03");
    // the override has served its purpose — the occurrence is now realized
    expect(storedRule("exp-1").occurrenceOverrides).toEqual({});
    expect(balance()).toBe(800);
  });

  it("keeps the realized row on its overridden date once the override is gone", async () => {
    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());
    await completeOccurrence("proj_exp-1::2026-03-20::exp-1_2026-03", 1_200);

    const view = snapshot();
    // the rule now regenerates March's occurrence on the 5th again, but the
    // stored row's occurrenceId still displaces it — so there is no double
    // count and the realized date wins
    expect(view.transactions).toHaveLength(7);
    expect(view.transactions.filter((t) => t.occurrenceId === "exp-1_2026-03")).toHaveLength(1);
    expect(rowOn(view, "2026-03-20").status).toBe("completed");
    expect(view.daily.get("2026-03-05")!.totalExpenses).toBe(0);
    expect(view.daily.get("2026-03-20")!.totalExpenses).toBe(1_200);
  });
});

// ============================================================================
// 7. LATE PAYMENT ACROSS A MONTH BOUNDARY
// ============================================================================

describe("late payment: paid in February, scheduled in January", () => {
  beforeEach(async () => {
    freezeToday("2026-02-04");
    seedWorld(2_000);
    // January's rent, 1250, actually paid on 2026-02-03
    await completeOccurrence(JAN_RENT_ID, 1_250, "2026-02-03");
  });

  it("files the payment on the day the money moved", () => {
    const view = snapshot();

    expect(dates(view.transactions)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-02-03",
      "2026-02-05",
      "2026-03-01",
      "2026-03-05",
    ]);
    expect(view.daily.get("2026-01-05")!.totalExpenses).toBe(0);
    expect(view.daily.get("2026-02-03")!.totalExpenses).toBe(1_250);
    expect(cents(view.daily.get("2026-02-03")!.closingBalance)).toBe(6_750);
  });

  /**
   * SPLIT ATTRIBUTION — pinned deliberately.
   *
   * `calculateMonthlyTotals` buckets on `actualDate || scheduledDate`
   * (summaryCalculations.ts:27) => cash basis, the payment lands in February.
   * `calculateVarianceReport` filters on `scheduledDate`
   * (variance.ts:21) => accrual basis, the same payment lands in January.
   *
   * Each choice is defensible on its own — "what left my account in February"
   * versus "how did January's budget do" — and the explicit, differing date
   * expressions in the two files read as intentional rather than accidental.
   * The problem is that nothing tells the user: the dashboard's February
   * expense figure and January's variance figure describe the same 1250 and
   * will never reconcile. Treated here as documented behaviour, not a bug.
   */
  it("buckets the payment into February for monthly totals", () => {
    const merged = snapshot().transactions;

    const january = calculateMonthlyTotals(merged, 2026, 0);
    expect(january.expenses).toBe(0);
    expect(january.income).toBe(3_000);
    expect(january.net).toBe(3_000);

    const february = calculateMonthlyTotals(merged, 2026, 1);
    // 1250 late January rent + 1200 February rent
    expect(february.expenses).toBe(2_450);
    expect(february.income).toBe(3_000);
    expect(february.net).toBe(550);
  });

  it("attributes the same payment to January for variance", () => {
    const merged = snapshot().transactions;

    const januaryVariance = calculateVarianceReport(merged, "2026-01-01", "2026-01-31");
    expect(januaryVariance.expenses.projected).toBe(1_200);
    expect(januaryVariance.expenses.actual).toBe(1_250);
    expect(januaryVariance.expenses.variance).toBe(50);

    const februaryVariance = calculateVarianceReport(merged, "2026-02-01", "2026-02-28");
    // February sees nothing, even though 1250 of February cash went out
    expect(februaryVariance.expenses.projected).toBe(0);
    expect(februaryVariance.expenses.actual).toBe(0);
  });

  it("keeps the scheduled date intact so the obligation stays in January", () => {
    const stored = onlyStoredRow();

    expect(stored.scheduledDate).toBe("2026-01-05");
    expect(stored.actualDate).toBe("2026-02-03");
    expect(stored.occurrenceId).toBe("exp-1_2026-01");
  });
});

// ============================================================================
// 8. LOAN LIFECYCLE
// ============================================================================

describe("loan lifecycle: paying the first of six amortized payments", () => {
  const LOAN_WINDOW: Window = { start: "2026-01-01", end: "2026-06-30" };

  /**
   * 6000 over 6 months at 12% APR (1%/month).
   * PMT = P·r(1+r)^n / ((1+r)^n − 1) = 6000·0.01·1.01^6 / (1.01^6 − 1) = 1035.29
   */
  const ORIGINAL_PMT = 1_035.29;
  /** The same principal re-amortized over 5 months instead of 6: 1236.24. */
  const REDERIVED_PMT = 1_236.24;

  const LOAN_DATES = [
    "2026-01-01",
    "2026-02-01",
    "2026-03-01",
    "2026-04-01",
    "2026-05-01",
    "2026-06-01",
  ];

  const seedLoanWorld = (): void => {
    store.__seed(
      "users",
      USER,
      makeUserProfile({ uid: USER, currentBalance: 20_000 }) as unknown as Record<string, unknown>
    );
    store.__seedEntities("expense_rules", [
      makeLoanRule(
        { id: "loan-1", amount: ORIGINAL_PMT, startDate: "2026-01-01" },
        {
          principalAmount: 6_000,
          currentBalance: 6_000,
          interestRate: 12,
          termMonths: 6,
          monthlyPayment: ORIGINAL_PMT,
          paymentsMade: 0,
          loanStartDate: "2026-01-01",
          firstPaymentDate: "2026-01-01",
        }
      ),
    ]);
  };

  const loanView = () => snapshot(LOAN_WINDOW);
  const projectedRows = (view: DerivedView): Transaction[] =>
    view.transactions.filter((t) => t.id.startsWith("proj_"));

  beforeEach(() => {
    freezeToday("2026-01-02");
    seedLoanWorld();
  });

  it("projects all six level payments before anything is paid", () => {
    const view = loanView();

    expect(dates(view.transactions)).toEqual(LOAN_DATES);
    view.transactions.forEach((t) => expect(t.projectedAmount).toBeCloseTo(ORIGINAL_PMT, 2));
    expect(view.transactions.map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(view.transactions.map((t) => t.paymentBreakdown!.totalPayments)).toEqual([
      6, 6, 6, 6, 6, 6,
    ]);
    // month 1 interest = 6000 × 1% = 60, so principal = 1035.29 - 60 = 975.29
    expect(view.transactions[0].paymentBreakdown!.interestPaid).toBeCloseTo(60, 2);
    expect(view.transactions[0].paymentBreakdown!.principalPaid).toBeCloseTo(975.29, 2);
  });

  it("records the first payment and displaces its projection", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    const stored = onlyStoredRow();
    expect(stored.status).toBe("completed");
    expect(stored.occurrenceId).toBe("loan-1_2026-01");
    expect(stored.actualAmount).toBe(ORIGINAL_PMT);
    // the realized row's projectedAmount comes from `source.amount`
    // (transactionActions.ts:94) — the RULE's headline figure — not from the
    // amortization step's `payment`, so variance is measured against a rounded
    // number rather than against the schedule the user was shown
    expect(stored.projectedAmount).toBe(ORIGINAL_PMT);
    expect(balance()).toBe(cents(20_000 - ORIGINAL_PMT));
    // no breakdown is carried onto the realized row at all
    expect(stored.paymentBreakdown).toBeUndefined();
  });

  it("advances paymentsMade but leaves the outstanding loan balance untouched", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    const config = storedRule("loan-1").loanConfig!;
    // transactionActions.ts:127-131 increments paymentsMade only; the stored-row
    // path (completeTransaction -> updateLoanBalance) would ALSO have reduced
    // currentBalance. The two completion paths disagree.
    expect(config.paymentsMade).toBe(1);
    expect(config.currentBalance).toBe(6_000);
  });

  it("drops the final payment from the remaining schedule", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    const view = loanView();
    // OBSERVED DRIFT: one payment made out of six, but only four remain
    // projected — the schedule ends on 2026-05-01 and 2026-06-01 vanishes.
    // loanProjections.ts:36-41 re-amortizes over `termMonths - paymentsMade`
    // months but still starts the schedule at `rule.startDate`, so the whole
    // remaining schedule slides one month earlier and loses its tail.
    expect(dates(view.transactions)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
    expect(projectedRows(view)).toHaveLength(4);
  });

  it("inflates every remaining payment by re-amortizing the unreduced principal", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    const view = loanView();
    // OBSERVED DRIFT: the full 6000 is re-amortized over 5 months
    // (6000·0.01·1.01^5 / (1.01^5 − 1) = 1236.24) because currentBalance was
    // never reduced. The user's projected payment jumps 19% after paying on time.
    projectedRows(view).forEach((t) => expect(t.projectedAmount).toBeCloseTo(REDERIVED_PMT, 2));
  });

  it("skips a payment number in the remaining schedule", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    const view = loanView();
    // OBSERVED DRIFT: paymentNumber = paymentsMade + index + 1
    // (loanProjections.ts:43), and index restarts at the schedule's head — which
    // is still 2026-01-01 — so the displaced first row absorbs number 2 and the
    // next visible payment is numbered 3. Payment 2 is never shown.
    expect(projectedRows(view).map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([3, 4, 5, 6]);
  });

  it("keeps the derived view internally consistent despite the drift", async () => {
    await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

    // snapshot() already asserts the double-count guard; this pins the visible
    // consequence: five rows where six payments are owed
    const view = loanView();
    expect(view.transactions).toHaveLength(5);
    expect(view.transactions.filter((t) => t.occurrenceId === "loan-1_2026-01")).toHaveLength(1);
  });

  describe("known defects", () => {
    /**
     * DEFECT: `markTransactionCompleteAction` increments
     * `loanConfig.paymentsMade` but never reduces `loanConfig.currentBalance`
     * (transactionActions.ts:125-131), while the stored-transaction path does
     * both via `updateLoanBalance` (expenseRules.ts:125-136). Since
     * `generateLoanProjections` re-amortizes `currentBalance` over
     * `termMonths - paymentsMade` months (loanProjections.ts:28-37), the
     * unreduced principal is squeezed into fewer months and every remaining
     * payment inflates.
     * CORRECT: after one payment the balance must fall by the principal portion,
     * 6000 - (1035.29 - 60) = 5024.71.
     */
    it.fails(
      "KNOWN DEFECT: completing a projected loan payment reduces the outstanding balance",
      async () => {
        await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

        expect(storedRule("loan-1").loanConfig!.currentBalance).toBeCloseTo(5_024.71, 2);
      }
    );

    /**
     * DEFECT: the remaining payments are re-amortized after every payment
     * (loanProjections.ts:32-37) instead of being read off the loan's original
     * schedule, so a borrower who pays exactly what was asked sees their next
     * five payments jump from 1035.29 to 1236.24.
     * CORRECT: a level-payment loan has level payments — the remaining
     * projections must keep the original PMT.
     */
    it.fails("KNOWN DEFECT: the remaining payments keep their original amount", async () => {
      await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

      projectedRows(loanView()).forEach((t) =>
        expect(t.projectedAmount).toBeCloseTo(ORIGINAL_PMT, 2)
      );
    });

    /**
     * DEFECT: the regenerated amortization schedule always starts at
     * `rule.startDate` (loanProjections.ts:36), so after the first payment the
     * remaining schedule occupies 2026-01-01..2026-05-01 rather than
     * 2026-02-01..2026-06-01. The final payment silently disappears from the
     * forecast, and the head of the schedule collides with an already-paid date.
     * CORRECT: the five remaining payments fall on 2026-02-01 .. 2026-06-01.
     */
    it.fails("KNOWN DEFECT: the remaining payments keep their original dates", async () => {
      await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

      expect(dates(projectedRows(loanView()))).toEqual([
        "2026-02-01",
        "2026-03-01",
        "2026-04-01",
        "2026-05-01",
        "2026-06-01",
      ]);
    });

    /**
     * DEFECT: `paymentNumber = loanConfig.paymentsMade + index + 1`
     * (loanProjections.ts:43) numbers by position in the REGENERATED schedule,
     * whose first entry is the already-paid month. Payment 2 is consumed by the
     * displaced row and the user's next payment is labelled 3 of 6.
     * CORRECT: the remaining payments are 2 through 6.
     */
    it.fails("KNOWN DEFECT: the remaining payments are numbered 2 through 6", async () => {
      await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

      expect(projectedRows(loanView()).map((t) => t.paymentBreakdown!.paymentNumber)).toEqual([
        2, 3, 4, 5, 6,
      ]);
    });

    /**
     * DEFECT: `markTransactionCompleteAction` copies `projectedAmount` from
     * `source.amount` (transactionActions.ts:94) — the rule's headline figure —
     * rather than from the amortized `payment` the projection actually showed
     * (loanProjections.ts:54, via `createProjectedTransaction`). For an
     * amortized loan the two differ, so variance on a loan payment is measured
     * against a number the user was never shown.
     * CORRECT: the realized row's projectedAmount must equal the projection's
     * projectedAmount it replaced.
     */
    it.fails(
      "KNOWN DEFECT: the realized row records the amount that was actually projected",
      async () => {
        const projectedAmount = loanView().transactions[0].projectedAmount;

        await completeOccurrence("proj_loan-1::2026-01-01::loan-1_2026-01", ORIGINAL_PMT);

        expect(onlyStoredRow().projectedAmount).toBe(projectedAmount);
      }
    );
  });
});

// ============================================================================
// 9. OVERDUE
// ============================================================================

describe("overdue: a projected bill whose day has passed", () => {
  beforeEach(() => {
    // February's rent (the 5th) is five days in the past and still unpaid
    freezeToday("2026-02-10");
    seedWorld(2_000);
  });

  it("keeps the overdue bill in the merged list", () => {
    const view = snapshot();

    expect(view.transactions).toHaveLength(6);
    const feb = rowOn(view, "2026-02-05");
    expect(feb.id).toBe(FEB_RENT_ID);
    expect(feb.status).toBe("projected");
    expect(feb.projectedAmount).toBe(1_200);
  });

  it("keeps spending the overdue bill in the daily balance map", () => {
    const view = snapshot();

    // the calendar/forecast still assumes the money goes out, which is right —
    // the bill is owed
    expect(view.daily.get("2026-02-05")!.totalExpenses).toBe(1_200);
    expect(closings(view)).toEqual(BASELINE_CLOSINGS);
  });

  it("excludes the overdue bill from bill coverage", () => {
    const view = snapshot();

    // getBillCoverageReport keeps only `date >= todayStr`
    // (billCoverage.ts:27-32), so the unpaid 2026-02-05 rent is dropped and the
    // 14-day window 2026-02-10..2026-02-24 looks completely clear
    expect(view.coverage.upcomingBills).toEqual([]);
    expect(view.coverage.totalUpcoming).toBe(0);
    expect(view.coverage.projectedBalance).toBe(2_000);
    expect(view.coverage.canCoverAll).toBe(true);
  });

  describe("known defects", () => {
    /**
     * DEFECT: `getBillCoverageReport` filters upcoming transactions with
     * `date >= todayStr` (billCoverage.ts:29-31) and only excludes `completed`
     * and `skipped` rows. A bill that is still `projected` but whose date has
     * passed is neither paid nor cancelled — it is OVERDUE and still owed — yet
     * it is silently dropped from `upcomingBills`, `totalUpcoming` and
     * `projectedBalance`. The "can I cover my bills?" widget therefore
     * overstates available cash by the sum of every unpaid overdue bill, which
     * is exactly the situation in which the user most needs the warning. (The
     * dashboard has a separate OverdueAlert surface, but that does not feed the
     * coverage numbers, so the two views contradict each other.)
     * CORRECT: an unpaid overdue bill must still be counted against the balance.
     */
    it.fails("KNOWN DEFECT: bill coverage counts an unpaid overdue bill", () => {
      const view = snapshot();

      expect(view.coverage.upcomingBills.map((b) => b.transaction.scheduledDate)).toEqual([
        "2026-02-05",
      ]);
      expect(view.coverage.totalUpcoming).toBe(1_200);
      expect(view.coverage.projectedBalance).toBe(800);
    });
  });

  it("brings the overdue bill back into coverage once it is paid late", async () => {
    await completeOccurrence(FEB_RENT_ID, 1_200, "2026-02-12");

    const view = snapshot();
    // completed rows are excluded from coverage by design, but the money has now
    // actually left the account, so currentBalance carries it instead
    expect(balance()).toBe(800);
    expect(view.coverage.currentBalance).toBe(800);
    expect(view.coverage.upcomingBills).toEqual([]);
    expect(view.daily.get("2026-02-05")!.totalExpenses).toBe(0);
    expect(view.daily.get("2026-02-12")!.totalExpenses).toBe(1_200);
  });
});

// ============================================================================
// 10. DOUBLE-COUNT GUARD
// ============================================================================

describe("double-count guard", () => {
  beforeEach(() => {
    freezeToday("2026-01-02");
    seedWorld(2_000);
  });

  it("never leaves a projection beside the row that realized it", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    await markTransactionSkippedAction(FEB_RENT_ID, undefined, USER, liveSources(), liveRules());
    await rescheduleTransactionAction(MAR_RENT_ID, "2026-03-20", USER, liveSources(), liveRules());

    const view = snapshot();
    // one row per occurrence, whatever state each occurrence is in
    expect(view.transactions).toHaveLength(6);
    const realized = view.transactions.filter((t) => !t.id.startsWith("proj_"));
    const projected = view.transactions.filter((t) => t.id.startsWith("proj_"));
    expect(realized.map((t) => t.occurrenceId)).toEqual(["exp-1_2026-01", "exp-1_2026-02"]);
    expect(projected.map((t) => t.occurrenceId)).toEqual([
      "inc-1_2026-01",
      "inc-1_2026-02",
      "inc-1_2026-03",
      "exp-1_2026-03",
    ]);
    expect(duplicates(view.transactions.map((t) => t.occurrenceId))).toEqual([]);
  });

  it("keeps each day's totals equal to the sum of that day's own rows", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    await markTransactionSkippedAction(FEB_RENT_ID, undefined, USER, liveSources(), liveRules());

    const view = snapshot();
    // spelled out here rather than only inside the shared guard, because this is
    // the exact identity the calendar renders per day
    daysBetween(WINDOW.start, WINDOW.end).forEach((day) => {
      const balanceForDay = view.daily.get(day)!;
      const net = balanceForDay.transactions
        .filter((t) => t.status !== "skipped")
        .reduce((total, t) => total + (t.type === "income" ? effective(t) : -effective(t)), 0);
      expect(net).toBeCloseTo(balanceForDay.totalIncome - balanceForDay.totalExpenses, 6);
      expect(balanceForDay.closingBalance).toBeCloseTo(balanceForDay.openingBalance + net, 6);
    });
  });

  it("keeps the window's net movement equal to the sum of every row in it", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);

    const view = snapshot();
    const opening = view.daily.get(WINDOW.start)!.openingBalance;
    const closing = view.daily.get(WINDOW.end)!.closingBalance;
    const net = view.transactions
      .filter((t) => t.status !== "skipped")
      .reduce((total, t) => total + (t.type === "income" ? effective(t) : -effective(t)), 0);

    // 3 × 3000 income - (1350 + 1200 + 1200) expenses = 5250
    expect(net).toBeCloseTo(5_250, 6);
    expect(closing - opening).toBeCloseTo(net, 6);
  });

  it("does not double-count when a stored row is edited through the repo directly", async () => {
    await completeOccurrence(JAN_RENT_ID, 1_350);
    // the transactions page edits the persisted row, bypassing the action layer
    await completeTransaction(onlyStoredRow().id, 900, "2026-01-06");

    const view = snapshot();
    expect(view.transactions).toHaveLength(6);
    expect(view.daily.get("2026-01-05")!.totalExpenses).toBe(0);
    expect(view.daily.get("2026-01-06")!.totalExpenses).toBe(900);
    expect(balance()).toBe(1_100);
  });
});
