import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("firebase/firestore", () => import("../helpers/firestoreEmulator"));
vi.mock("@/lib/firebase/config", () => import("../helpers/firebaseConfigMock"));

import type { ExpenseRule, IncomeSource, Transaction, UserProfile } from "@/lib/types";
import {
  addManualTransactionAction,
  markTransactionCompleteAction,
  markTransactionSkippedAction,
  removeTransactionAction,
  rescheduleTransactionAction,
  revertTransactionToProjectedAction,
  updateManualTransactionAction,
} from "@/contexts/FinancialContext/actions/transactionActions";
import { mergeTransactionsWithProjections } from "@/contexts/FinancialContext/utils/projectionMerger";
import {
  LedgerOwnershipError,
  ResetIncompleteError,
  completeTransaction,
  deleteAllUserData,
  deleteSelectiveUserData,
  migrateToInitialBalance,
  overrideCurrentBalance,
  recalculateBalance,
  setInitialBalance,
} from "@/lib/firebase/firestore";
import * as store from "../helpers/firestoreEmulator";
import {
  makeCompletedTransaction,
  makeCreditConfig,
  makeCreditRule,
  makeExpenseRule,
  makeIncomeSource,
  makeInstallmentRule,
  makeLoanConfig,
  makeLoanRule,
  makeManualTransaction,
  makeUserProfile,
} from "../helpers/builders";
import { freezeToday } from "../helpers/time";

/**
 * THE LEDGER: one atomic write path for a stored row, the realized balance, loan / card /
 * installment progress and occurrence overrides (docs/audit/fixes/write-path.md).
 *
 * Every expected number in this file is worked out by hand in a comment or by an
 * independent model written here; nothing calls an app function to derive one.
 *
 * INVARIANTS checked after every gesture of the state machine:
 *   I1  users.currentBalance == initialBalance + SUM(signed(completed stored rows))
 *   I2  loan:        currentBalance == principal - SUM(paid) and paymentsMade == #completed rows
 *       card:        currentBalance == opening - SUM(paid)
 *       installment: installmentsPaid == #completed rows
 *   I3  no two stored rows share (sourceId, occurrenceId)
 *   I4  a row that is not completed carries no actualAmount / actualDate / variance
 */

const USER = "user-1";
const OTHER = "user-2";
const TODAY = "2026-02-01";
const WINDOW = { start: "2026-01-01", end: "2026-03-31" };

// ---------------------------------------------------------------------------
// The world. Interest is 0 everywhere, so "principal removed" == "amount paid" and the
// expected debt figures are plain subtraction.
// ---------------------------------------------------------------------------

const OPENING = 10_000;
const LOAN_PRINCIPAL = 1_200; // 12 x 100 at 0%
const CARD_OPENING = 1_000; // 0% APR

const salary = (): IncomeSource =>
  makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, startDate: "2026-01-02", endDate: "2026-03-02" });
const rent = (): ExpenseRule =>
  makeExpenseRule({ id: "rent", name: "Rent", amount: 1_200, startDate: "2026-01-10", endDate: "2026-03-10" });
const loan = (): ExpenseRule =>
  makeLoanRule(
    { id: "loan", name: "Loan", amount: 100, startDate: "2026-01-20" },
    {
      principalAmount: LOAN_PRINCIPAL,
      currentBalance: LOAN_PRINCIPAL,
      interestRate: 0,
      termMonths: 12,
      monthlyPayment: 100,
      loanStartDate: "2026-01-20",
      firstPaymentDate: "2026-01-20",
    }
  );
const card = (): ExpenseRule =>
  makeCreditRule(
    { id: "card", name: "Card", amount: 400, startDate: "2026-01-25", scheduleConfig: { dayOfMonth: 25 } },
    makeCreditConfig({
      creditLimit: 5_000,
      currentBalance: CARD_OPENING,
      apr: 0,
      paymentStrategy: "fixed",
      fixedPaymentAmount: 400,
      dueDate: 25,
      statementDate: 5,
    })
  );
const plan = (): ExpenseRule =>
  makeInstallmentRule({ id: "plan", name: "Plan", amount: 200, startDate: "2026-01-15" });
const coffee = (): Transaction =>
  makeManualTransaction({
    id: "m1",
    name: "Coffee",
    type: "expense",
    projectedAmount: 50,
    scheduledDate: "2026-01-18",
    status: "projected",
  });

const seedWorld = (): void => {
  store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: OPENING, initialBalance: OPENING }));
  store.__seedEntities("income_sources", [salary()]);
  store.__seedEntities("expense_rules", [rent(), loan(), card(), plan()]);
  store.__seedEntities("transactions", [coffee()]);
};

// ---------------------------------------------------------------------------
// Readers (straight from the store; the state the user's next session would load)
// ---------------------------------------------------------------------------

const profile = () => store.__get<UserProfile>("users", USER)!;
const balance = () => profile().currentBalance;
const rows = () => store.__all<Transaction>("transactions");
const rule = (id: string) => store.__get<ExpenseRule>("expense_rules", id)!;
const incomes = () => store.__all<IncomeSource>("income_sources");
const rules = () => store.__all<ExpenseRule>("expense_rules");

/** What the context hands the UI: stored rows (as subscribed) merged with projections. */
const merged = (): Transaction[] =>
  mergeTransactionsWithProjections(
    rows().filter((t) => t.sourceType === "manual" || t.status === "completed" || t.status === "skipped"),
    incomes(),
    rules(),
    WINDOW,
    USER
  );
const find = (pred: (t: Transaction) => boolean): Transaction => {
  const hit = merged().find(pred);
  if (!hit) throw new Error("no merged row matched");
  return hit;
};
const occ = (sourceId: string, month: string): Transaction =>
  find((t) => t.sourceId === sourceId && t.scheduledDate.startsWith(month));

const complete = (id: string, actualAmount: number, userId = USER) =>
  markTransactionCompleteAction(id, { actualAmount }, userId, incomes(), rules());
const skip = (id: string, userId = USER) => markTransactionSkippedAction(id, undefined, userId, incomes(), rules());

beforeEach(() => {
  store.__reset();
  freezeToday(TODAY);
});

// ===========================================================================
// 1. STATE MACHINE: invariants after every gesture, against an independent model
// ===========================================================================

/** Hand-written oracle. Holds only what the USER did: which rows are completed, for how much. */
class Model {
  /** key -> completed amount (absent = not completed) */
  completed = new Map<string, { amount: number; sign: 1 | -1; source: string }>();

  expectedBalance(): number {
    let b = OPENING;
    this.completed.forEach((c) => (b += c.sign * c.amount));
    return Math.round(b * 100) / 100;
  }
  paidOn(source: string): { count: number; sum: number } {
    let count = 0;
    let sum = 0;
    this.completed.forEach((c) => {
      if (c.source === source) {
        count += 1;
        sum += c.amount;
      }
    });
    return { count, sum };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const signedOf = (t: { type: string }) => (t.type === "income" ? 1 : -1);

function violations(model: Model): string[] {
  const out: string[] = [];
  const all = rows();
  const p = profile();

  // I1, against the stored rows AND against the model
  const fromRows = round2(
    p.initialBalance +
      all.reduce(
        (s, t) => (t.status === "completed" ? s + signedOf(t) * (t.actualAmount ?? t.projectedAmount) : s),
        0
      )
  );
  if (round2(p.currentBalance) !== fromRows) out.push(`I1 balance ${p.currentBalance} != initial + SUM(rows) ${fromRows}`);
  if (round2(p.currentBalance) !== model.expectedBalance()) {
    out.push(`I1 balance ${p.currentBalance} != model ${model.expectedBalance()}`);
  }

  // I2 debt counters, against the model (amount paid, interest 0 => principal == paid)
  const l = model.paidOn("loan");
  const loanCfg = rule("loan").loanConfig!;
  if (loanCfg.paymentsMade !== l.count) out.push(`I2 loan paymentsMade ${loanCfg.paymentsMade} != ${l.count}`);
  if (round2(loanCfg.currentBalance) !== round2(LOAN_PRINCIPAL - l.sum)) {
    out.push(`I2 loan balance ${loanCfg.currentBalance} != ${LOAN_PRINCIPAL - l.sum}`);
  }
  const c = model.paidOn("card");
  const cardCfg = rule("card").creditConfig!;
  if (round2(cardCfg.currentBalance) !== round2(CARD_OPENING - c.sum)) {
    out.push(`I2 card balance ${cardCfg.currentBalance} != ${CARD_OPENING - c.sum}`);
  }
  const i = model.paidOn("plan");
  const planCfg = rule("plan").installmentConfig!;
  if (planCfg.installmentsPaid !== i.count) out.push(`I2 installmentsPaid ${planCfg.installmentsPaid} != ${i.count}`);

  // I3, I4
  const seen = new Set<string>();
  for (const t of all) {
    if (t.sourceId && t.occurrenceId) {
      const k = `${t.sourceId}|${t.occurrenceId}`;
      if (seen.has(k)) out.push(`I3 duplicate stored occurrence ${k}`);
      seen.add(k);
    }
    if (t.status !== "completed" && ("actualDate" in t && t.actualDate !== undefined)) {
      // (a stored non-completed row must not carry completion data)
      out.push(`I4 ${t.id} is ${t.status} but has actualDate`);
    }
    if (t.status !== "completed" && t.variance !== undefined) out.push(`I4 ${t.id} is ${t.status} but has variance`);
  }
  return out;
}

type Gesture = "complete" | "skip" | "revert" | "reschedule" | "delete" | "edit-type" | "edit-amount";

const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const AMOUNTS = [50, 75, 100, 125, 150];
const DATES = ["2026-01-05", "2026-01-12", "2026-01-22", "2026-02-03", "2026-02-20"];

const keyOf = (t: Transaction): string => (t.sourceType === "manual" ? t.id : `${t.sourceId}|${t.occurrenceId}`);
const sourceOf = (t: Transaction): string => (t.sourceType === "manual" ? "manual" : (t.sourceId as string));

/** Apply one gesture through the real action layer, and to the model. Returns a trace label. */
async function apply(model: Model, target: Transaction, g: Gesture, amount: number, date: string): Promise<string> {
  const key = keyOf(target);
  const stored = !target.id.startsWith("proj_");
  const label = `${g}(${sourceOf(target)} ${target.scheduledDate} ${target.status}${stored ? "" : " proj"}, ${amount})`;
  const manual = target.sourceType === "manual";
  switch (g) {
    case "complete":
      if (manual) {
        await updateManualTransactionAction(
          target.id,
          { status: "completed", actualAmount: amount, actualDate: target.scheduledDate },
          USER
        );
      } else {
        await markTransactionCompleteAction(target.id, { actualAmount: amount }, USER, incomes(), rules());
      }
      model.completed.set(key, { amount, sign: signedOf(target) as 1 | -1, source: sourceOf(target) });
      break;
    case "skip":
      if (manual) await updateManualTransactionAction(target.id, { status: "skipped" }, USER);
      else await markTransactionSkippedAction(target.id, undefined, USER, incomes(), rules());
      model.completed.delete(key);
      break;
    case "revert":
      if (manual) await updateManualTransactionAction(target.id, { status: "projected" }, USER);
      else await revertTransactionToProjectedAction(target.id, USER);
      model.completed.delete(key);
      break;
    case "reschedule":
      await rescheduleTransactionAction(target.id, date, USER, incomes(), rules());
      break;
    case "delete":
      await removeTransactionAction(target.id, USER);
      model.completed.delete(key);
      break;
    case "edit-type": {
      const flipped = target.type === "income" ? "expense" : "income";
      await updateManualTransactionAction(target.id, { type: flipped }, USER);
      const prev = model.completed.get(key);
      if (prev) model.completed.set(key, { ...prev, sign: flipped === "income" ? 1 : -1 });
      break;
    }
    case "edit-amount": {
      await updateManualTransactionAction(
        target.id,
        target.status === "completed" ? { projectedAmount: amount, actualAmount: amount } : { projectedAmount: amount },
        USER
      );
      const prev = model.completed.get(key);
      if (prev) model.completed.set(key, { ...prev, amount });
      break;
    }
  }
  return label;
}

/** The gestures the UI offers for a merged row. */
function available(t: Transaction): Gesture[] {
  const stored = !t.id.startsWith("proj_");
  const manual = t.sourceType === "manual";
  const out: Gesture[] = ["complete", "skip", "reschedule"];
  if (stored && t.status !== "projected") out.push("revert");
  if (manual) out.push("delete", "edit-type", "edit-amount");
  // a manual row that is projected: "revert" is not offered (it is already projected)
  return out;
}

describe("state machine: every gesture keeps balance, debt progress and rows consistent", () => {
  it("the fixture satisfies every invariant before any gesture", () => {
    seedWorld();
    expect(violations(new Model())).toEqual([]);
  });

  it("hand-derived walk: loan, card and installment payments, re-completion, skip and revert", async () => {
    seedWorld();
    const model = new Model();
    const check = (label: string) => expect(violations(model), label).toEqual([]);

    // 1. Loan payment 1: 100. Balance 10,000 - 100 = 9,900; loan 1,200 -> 1,100, 1 payment.
    const jan = occ("loan", "2026-01");
    await apply(model, jan, "complete", 100, "");
    expect(balance()).toBe(9_900);
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
    check("loan paid");

    // 2. Re-complete the SAME payment for 150 (a correction): balance 10,000 - 150 = 9,850,
    //    loan 1,200 - 150 = 1,050, STILL one payment (not two).
    await apply(model, find((t) => keyOf(t) === keyOf(jan)), "complete", 150, "");
    expect(balance()).toBe(9_850);
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_050, paymentsMade: 1 });
    check("loan re-completed");

    // 3. Card payment 400 (0% APR): card 1,000 -> 600, balance 9,850 - 400 = 9,450.
    const cardJan = occ("card", "2026-01");
    await apply(model, cardJan, "complete", 400, "");
    expect(rule("card").creditConfig!.currentBalance).toBe(600);
    expect(balance()).toBe(9_450);
    check("card paid");

    // 4. Installment 1 of 6 (200): paid 1, balance 9,250. Complete it again for 200: still 1.
    const planJan = occ("plan", "2026-01");
    await apply(model, planJan, "complete", 200, "");
    await apply(model, find((t) => keyOf(t) === keyOf(planJan)), "complete", 200, "");
    expect(rule("plan").installmentConfig!.installmentsPaid).toBe(1);
    expect(balance()).toBe(9_250);
    check("installment paid twice");

    // 5. Skip the completed loan payment: everything it did is undone.
    //    loan back to 1,200 / 0 payments; balance 9,250 + 150 = 9,400; the row carries no actual.
    await apply(model, find((t) => keyOf(t) === keyOf(jan)), "skip", 0, "");
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_200, paymentsMade: 0 });
    expect(balance()).toBe(9_400);
    const skipped = rows().find((t) => t.sourceId === "loan")!;
    expect(skipped.status).toBe("skipped");
    expect("actualAmount" in skipped).toBe(false);
    check("loan skipped");

    // 6. Pay the skipped loan payment again (100): counts once, balance 9,300.
    await apply(model, find((t) => keyOf(t) === keyOf(jan)), "complete", 100, "");
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
    expect(balance()).toBe(9_300);
    check("skipped loan paid");

    // 7. Revert the card payment: row deleted, card 1,000 again, balance 9,300 + 400 = 9,700.
    await apply(model, find((t) => keyOf(t) === keyOf(cardJan)), "revert", 0, "");
    expect(rule("card").creditConfig!.currentBalance).toBe(1_000);
    expect(balance()).toBe(9_700);
    expect(rows().filter((t) => t.sourceId === "card")).toHaveLength(0);
    check("card reverted");
  });

  it("manual rows: create as completed, flip type, edit amount, leave completed, delete", async () => {
    seedWorld();
    const model = new Model();
    const check = (label: string) => expect(violations(model), label).toEqual([]);

    // Coffee: completed at 60 -> 10,000 - 60 = 9,940
    await apply(model, find((t) => t.id === "m1"), "complete", 60, "");
    expect(balance()).toBe(9_940);
    check("coffee completed");

    // flip to income: undo -60 and add +60 => 9,940 + 120 = 10,060
    await apply(model, find((t) => t.id === "m1"), "edit-type", 0, "");
    expect(balance()).toBe(10_060);
    check("flipped");

    // amount to 100 (income): 10,000 + 100 = 10,100
    await apply(model, find((t) => t.id === "m1"), "edit-amount", 100, "");
    expect(balance()).toBe(10_100);
    check("amount edited");

    // revert to projected: back to 10,000 and no actual fields remain
    await apply(model, find((t) => t.id === "m1"), "revert", 0, "");
    expect(balance()).toBe(10_000);
    check("reverted");

    // a manual row CREATED as completed moves the balance in the same commit: expense 40 -> 9,960
    const created = await addManualTransactionAction(
      {
        sourceType: "manual",
        name: "Lunch",
        type: "expense",
        category: "dining",
        projectedAmount: 40,
        actualAmount: 40,
        scheduledDate: "2026-01-14",
        actualDate: "2026-01-14",
        status: "completed",
      },
      USER
    );
    model.completed.set(created.id, { amount: 40, sign: -1, source: "manual" });
    expect(balance()).toBe(9_960);
    check("created completed");

    // deleting it gives the 40 back
    await removeTransactionAction(created.id, USER);
    model.completed.delete(created.id);
    expect(balance()).toBe(10_000);
    check("deleted");
  });

  it.each([1, 7, 42, 2026, 31337, 9001])(
    "seeded random walk of 120 gestures over income, expense, loan, card, installment and manual rows (seed %i)",
    async (seed) => {
      seedWorld();
      const model = new Model();
      const rand = rng(seed);
      const trace: string[] = [];
      for (let step = 0; step < 120; step += 1) {
        const list = merged();
        const target = list[Math.floor(rand() * list.length)];
        const options = available(target);
        const g = options[Math.floor(rand() * options.length)];
        const amount = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
        const date = DATES[Math.floor(rand() * DATES.length)];
        // (a reschedule onto the day it is already on is a no-op the UI never offers)
        if (g === "reschedule" && date === target.scheduledDate) continue;
        trace.push(await apply(model, target, g, amount, date));
        const v = violations(model);
        if (v.length > 0) {
          throw new Error(`seed ${seed}, step ${step + 1}: ${v.join("; ")}\n  ${trace.map((t, i) => `${i + 1}. ${t}`).join("\n  ")}`);
        }
      }
      expect(trace.length).toBeGreaterThan(80);
    },
    120_000
  );
});

// ===========================================================================
// 2. CONCURRENCY
// ===========================================================================

describe("concurrency: transactions serialise instead of losing updates", () => {
  it("two completions in flight at once both land (UI-BAL-42)", async () => {
    seedWorld();
    const sal = occ("sal", "2026-01");
    const rnt = occ("rent", "2026-01");
    await Promise.all([complete(sal.id, 3_000), complete(rnt.id, 1_200)]);
    // 10,000 + 3,000 - 1,200 = 11,800, and both rows are stored as completed
    expect(balance()).toBe(11_800);
    expect(rows().filter((t) => t.status === "completed")).toHaveLength(2);
  });

  it("two waves of three gestures racing (income, expense, loan, card, installment, manual create) still sum exactly", async () => {
    // (three in flight at once is already far beyond one person with two tabs; the Firestore
    // client retries a contended transaction up to 5 times, and so does the emulator)
    seedWorld();
    await Promise.all([
      complete(occ("sal", "2026-01").id, 3_000), //      +3,000
      complete(occ("rent", "2026-01").id, 1_200), //      -1,200
      complete(occ("loan", "2026-01").id, 100), //        -100
    ]);
    const jobs = [
      complete(occ("card", "2026-01").id, 400), //        -400
      complete(occ("plan", "2026-01").id, 200), //        -200
      addManualTransactionAction(
        {
          sourceType: "manual",
          name: "Tip",
          type: "income",
          category: "other",
          projectedAmount: 25,
          actualAmount: 25,
          scheduledDate: "2026-01-14",
          actualDate: "2026-01-14",
          status: "completed",
        },
        USER
      ), //                                               +25
    ];
    await Promise.all(jobs);
    // 10,000 + 3,000 - 1,200 - 100 - 400 - 200 + 25 = 11,125
    expect(balance()).toBe(11_125);
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
    expect(rule("card").creditConfig!.currentBalance).toBe(600);
    expect(rule("plan").installmentConfig!.installmentsPaid).toBe(1);
  });

  it("the same occurrence completed twice at the same instant (double click / two tabs) is stored and counted once", async () => {
    seedWorld();
    const target = occ("loan", "2026-01");
    await Promise.all([complete(target.id, 100), complete(target.id, 100)]);
    expect(rows().filter((t) => t.sourceId === "loan")).toHaveLength(1);
    expect(balance()).toBe(9_900);
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
  });

  it("a stale second tab that still shows the projection: completing it again is an update of the same row, never a second payment (E2E-ROB-11)", async () => {
    seedWorld();
    const projection = occ("rent", "2026-01"); // what BOTH tabs are looking at
    expect(projection.id.startsWith("proj_")).toBe(true);
    await complete(projection.id, 1_200); // tab 1
    await complete(projection.id, 1_300); // tab 2, stale: same proj_ id, different amount
    const stored = rows().filter((t) => t.sourceId === "rent");
    expect(stored).toHaveLength(1);
    // the last write wins as a REPLACEMENT: 10,000 - 1,300, not 10,000 - 1,200 - 1,300
    expect(stored[0].actualAmount).toBe(1_300);
    expect(balance()).toBe(8_700);
  });

  it("a completion and a skip of the same occurrence racing leave a consistent state, whichever wins", async () => {
    seedWorld();
    const target = occ("rent", "2026-01");
    await Promise.all([complete(target.id, 1_200), skip(target.id)]);
    const stored = rows().filter((t) => t.sourceId === "rent");
    expect(stored).toHaveLength(1);
    expect(balance()).toBe(stored[0].status === "completed" ? 8_800 : 10_000);
  });
});

// ===========================================================================
// 3. ATOMICITY: a failure leaves nothing half-applied, and a retry is not a duplicate
// ===========================================================================

describe("atomicity under injected failures", () => {
  it.each(["users", "expense_rules", "transactions"] as const)(
    "a loan completion whose write to '%s' is rejected changes nothing, and the retry succeeds once",
    async (collection) => {
      seedWorld();
      const target = occ("loan", "2026-01");
      store.__injectFault({ collection });
      await expect(complete(target.id, 100)).rejects.toThrow("Firestore fault injected");
      // nothing: no row, balance and loan untouched
      expect(rows().filter((t) => t.sourceId === "loan")).toHaveLength(0);
      expect(balance()).toBe(10_000);
      expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_200, paymentsMade: 0 });

      await complete(target.id, 100); // the retry (the fault was consumed)
      expect(rows().filter((t) => t.sourceId === "loan")).toHaveLength(1);
      expect(balance()).toBe(9_900);
      expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
    }
  );

  it("a rejected edit of a completed manual row leaves the row AND the balance as they were (E2E-ROB-03)", async () => {
    seedWorld();
    store.__seed(
      "transactions",
      "c1",
      makeCompletedTransaction({ id: "c1", sourceType: "manual", type: "expense", projectedAmount: 60, scheduledDate: "2026-01-05" })
    );
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 9_940, initialBalance: OPENING }));
    store.__injectFault({ collection: "transactions" });
    await expect(updateManualTransactionAction("c1", { projectedAmount: 80, actualAmount: 80 }, USER)).rejects.toThrow();
    expect(balance()).toBe(9_940);
    expect(store.__get<Transaction>("transactions", "c1")!.actualAmount).toBe(60);
  });

  it("a rejected revert keeps the row, the balance, the loan progress and the override", async () => {
    seedWorld();
    const target = occ("loan", "2026-01");
    await complete(target.id, 100);
    const opsBefore = store.__ops.length;
    store.__injectFault({ collection: "users" });
    await expect(revertTransactionToProjectedAction(rows().find((t) => t.sourceId === "loan")!.id, USER)).rejects.toThrow();
    expect(store.__ops.length).toBe(opsBefore); // nothing was applied at all
    expect(rows().filter((t) => t.sourceId === "loan")).toHaveLength(1);
    expect(balance()).toBe(9_900);
    expect(rule("loan").loanConfig).toMatchObject({ currentBalance: 1_100, paymentsMade: 1 });
  });

  it("a reset whose single batch is rejected deletes NOTHING, profile included (E2E-ROB-05)", async () => {
    seedWorld();
    store.__seed("alerts", "a1", { id: "a1", userId: USER });
    store.__injectFault({ collection: "transactions" });
    await expect(deleteAllUserData(USER)).rejects.toThrow("Firestore fault injected");
    expect(store.__count("income_sources")).toBe(1);
    expect(store.__count("expense_rules")).toBe(4);
    expect(store.__count("transactions")).toBe(1);
    expect(store.__count("alerts")).toBe(1);
    expect(balance()).toBe(OPENING);
    expect(profile().initialBalance).toBe(OPENING);
  });

  it("a reset larger than one batch that fails part-way says exactly what happened, leaves the balance alone, and can be re-run to finish", async () => {
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 700, initialBalance: 1_000 }));
    // 501 stored rows: batch 1 = 500 deletes, batch 2 = 1 delete + the balance reset
    store.__seedEntities(
      "transactions",
      Array.from({ length: 501 }, (_, i) =>
        makeManualTransaction({ id: `t${i}`, status: i === 0 ? "completed" : "skipped", projectedAmount: 300, scheduledDate: "2026-01-05" })
      )
    );
    store.__injectFault({ collection: "users" }); // the LAST batch carries the profile update
    let error: unknown;
    try {
      await deleteSelectiveUserData(USER, ["transactions"]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ResetIncompleteError);
    expect((error as ResetIncompleteError).deleted).toBe(500);
    expect((error as ResetIncompleteError).total).toBe(501);
    expect((error as Error).message).toContain("500 of 501 items were deleted, 1 remain");
    expect((error as Error).message).toContain("your balance was not changed");
    expect(store.__count("transactions")).toBe(1);
    expect(balance()).toBe(700);

    await deleteSelectiveUserData(USER, ["transactions"]); // the re-run finishes it
    expect(store.__count("transactions")).toBe(0);
    expect(profile()).toMatchObject({ currentBalance: 0, initialBalance: 0 });
  });

  it("the balance reset never happens without the deletes: 500 documents fill a batch, the reset gets its own", async () => {
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 50, initialBalance: 50 }));
    store.__seedEntities(
      "transactions",
      Array.from({ length: 500 }, (_, i) => makeManualTransaction({ id: `t${i}`, status: "skipped", scheduledDate: "2026-01-05" }))
    );
    await deleteSelectiveUserData(USER, ["transactions"]);
    expect(store.__count("transactions")).toBe(0);
    expect(profile()).toMatchObject({ currentBalance: 0, initialBalance: 0 });
    expect(store.writeBatch.mock.calls).toHaveLength(2); // 500 deletes, then the reset alone
  });
});

// ===========================================================================
// 4. OWNERSHIP: an action never acts across a user switch
// ===========================================================================

describe("ownership guard (E2E-ROB-07)", () => {
  it("completing another user's stored row is refused and nothing changes for either user", async () => {
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 1_000, initialBalance: 1_000 }));
    store.__seed("users", OTHER, makeUserProfile({ uid: OTHER, currentBalance: 2_222, initialBalance: 2_222 }));
    store.__seed("transactions", "ta", makeManualTransaction({ id: "ta", userId: USER, name: "Alice Coffee", projectedAmount: 7 }));
    await expect(markTransactionCompleteAction("ta", { actualAmount: 70 }, OTHER, [], [])).rejects.toBeInstanceOf(LedgerOwnershipError);
    expect(store.__get<UserProfile>("users", OTHER)!.currentBalance).toBe(2_222);
    expect(store.__get<UserProfile>("users", USER)!.currentBalance).toBe(1_000);
    expect(store.__get<Transaction>("transactions", "ta")!.status).toBe("projected");
  });

  it.each([
    ["skip", (id: string) => markTransactionSkippedAction(id, undefined, OTHER, [], [])],
    ["revert", (id: string) => revertTransactionToProjectedAction(id, OTHER)],
    ["delete", (id: string) => removeTransactionAction(id, OTHER)],
    ["edit", (id: string) => updateManualTransactionAction(id, { projectedAmount: 99 }, OTHER)],
    ["reschedule", (id: string) => rescheduleTransactionAction(id, "2026-02-02", OTHER, [], [])],
  ])("%s on another user's row is refused", async (_name, act) => {
    store.__seed("users", OTHER, makeUserProfile({ uid: OTHER, currentBalance: 2_222, initialBalance: 2_222 }));
    store.__seed("transactions", "ta", makeManualTransaction({ id: "ta", userId: USER, projectedAmount: 7 }));
    const before = store.__get<Transaction>("transactions", "ta");
    await expect(act("ta")).rejects.toThrow();
    expect(store.__get<Transaction>("transactions", "ta")).toEqual(before);
    expect(store.__get<UserProfile>("users", OTHER)!.currentBalance).toBe(2_222);
  });
});

// ===========================================================================
// 5. BALANCE TOOLS read ALL stored rows
// ===========================================================================

describe("Recalculate, Override and Update Initial Balance", () => {
  const seedHistory = () => {
    // initial 1,000; completed: +300 income, -100 expense (net +200); a projected row and a skipped
    // row that must not count; another user's completed row that must not count.
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 999, initialBalance: 1_000 }));
    store.__seedEntities("transactions", [
      makeCompletedTransaction({ id: "a", type: "income", projectedAmount: 300, scheduledDate: "2024-01-05" }), // 2 years old
      makeCompletedTransaction({ id: "b", type: "expense", projectedAmount: 100, scheduledDate: "2024-02-05" }),
      makeManualTransaction({ id: "p", status: "projected", projectedAmount: 50 }),
      makeManualTransaction({ id: "s", status: "skipped", projectedAmount: 60 }),
      makeCompletedTransaction({ id: "x", userId: OTHER, type: "income", projectedAmount: 9_000, scheduledDate: "2026-01-05" }),
    ]);
  };

  it("Recalculate = initial + SUM(ALL stored completed rows), however old, in both directions", async () => {
    seedHistory();
    await expect(recalculateBalance(USER)).resolves.toEqual({ previous: 999, computed: 1_200 }); // 1,000 + 300 - 100
    expect(balance()).toBe(1_200);

    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 5_000, initialBalance: 1_000 }));
    await recalculateBalance(USER);
    expect(balance()).toBe(1_200); // too high -> lowered
  });

  it("Override sets the balance and lets the BASELINE absorb the difference: initial = target - SUM(completed)", async () => {
    seedHistory();
    await overrideCurrentBalance(USER, 5_000);
    // SUM(completed) = +200, so initial = 5,000 - 200 = 4,800 and 4,800 + 200 = 5,000
    expect(profile()).toMatchObject({ currentBalance: 5_000, initialBalance: 4_800 });
    await recalculateBalance(USER); // the recovery tool must not undo it
    expect(balance()).toBe(5_000);
    expect(rows().filter((t) => t.id === "a")).toHaveLength(1); // the ledger is untouched
  });

  it("Update Initial Balance moves the current balance with it: current = new initial + SUM(completed)", async () => {
    seedHistory();
    await expect(setInitialBalance(USER, 50)).resolves.toBe(250); // 50 + 200
    expect(profile()).toMatchObject({ currentBalance: 250, initialBalance: 50 });
  });

  it("an override racing a completion still ends on the typed balance with the invariant intact", async () => {
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 1_000, initialBalance: 1_000 }));
    store.__seed("transactions", "t1", makeManualTransaction({ id: "t1", type: "expense", projectedAmount: 10, scheduledDate: "2026-01-05" }));
    // a completion lands AFTER the override has summed the ledger but BEFORE it commits
    const realGetDocs = store.getDocs.getMockImplementation() as (...a: unknown[]) => Promise<unknown>;
    store.getDocs.mockImplementationOnce((async (...args: unknown[]) => {
      const result = await realGetDocs(...args);
      await completeTransaction("t1", 10);
      return result;
    }) as never);
    await overrideCurrentBalance(USER, 700);
    // the tool retried: SUM(completed) is now -10, so initial = 700 - (-10) = 710
    expect(profile()).toMatchObject({ currentBalance: 700, initialBalance: 710 });
  });
});

// ===========================================================================
// 6. THE ONE-TIME REBASE (decision D1)
// ===========================================================================

describe("migrateToInitialBalance: versioned rebase", () => {
  const legacyProfile = (over: Record<string, unknown>) => {
    const p: Record<string, unknown> = { ...makeUserProfile({ uid: USER }), ...over };
    delete p.balanceModelVersion;
    Object.keys(over).forEach((k) => over[k] === undefined && delete p[k]);
    store.__seed("users", USER, p);
  };
  const history = () =>
    store.__seedEntities("transactions", [
      makeCompletedTransaction({ id: "h1", type: "income", projectedAmount: 20_000, scheduledDate: "2026-01-02" }),
      makeCompletedTransaction({ id: "h2", type: "expense", projectedAmount: 2_000, scheduledDate: "2026-01-05" }),
    ]);

  it("sets initialBalance = currentBalance - SUM(completed) and keeps currentBalance: 23,000 - 18,000 = 5,000", async () => {
    legacyProfile({ currentBalance: 23_000, initialBalance: undefined });
    history();
    await migrateToInitialBalance(USER);
    expect(profile()).toMatchObject({ currentBalance: 23_000, initialBalance: 5_000, balanceModelVersion: 1 });
  });

  it("a profile the OLD migration seeded (initial == current, history double counted) is rebased too", async () => {
    legacyProfile({ currentBalance: 23_000, initialBalance: 23_000 });
    history();
    await migrateToInitialBalance(USER);
    expect(profile().initialBalance).toBe(5_000);
  });

  it("runs once: a second run, and a run on a profile already on the model, write nothing", async () => {
    legacyProfile({ currentBalance: 23_000, initialBalance: 23_000 });
    history();
    await migrateToInitialBalance(USER);
    const after = store.__ops.length;
    await migrateToInitialBalance(USER);
    expect(store.__ops.length).toBe(after);

    store.__reset();
    store.__seed("users", USER, makeUserProfile({ uid: USER, currentBalance: 1, initialBalance: 99 })); // version 1 fixture
    await migrateToInitialBalance(USER);
    expect(store.__ops).toHaveLength(0);
    expect(profile().initialBalance).toBe(99);
  });

  it("two tabs logging in at the same instant rebase once", async () => {
    legacyProfile({ currentBalance: 23_000, initialBalance: undefined });
    history();
    await Promise.all([migrateToInitialBalance(USER), migrateToInitialBalance(USER)]);
    expect(store.__opsFor("users")).toHaveLength(1);
    expect(profile().initialBalance).toBe(5_000);
  });

  it("only counts the user's OWN completed rows", async () => {
    legacyProfile({ currentBalance: 500, initialBalance: undefined });
    store.__seedEntities("transactions", [
      makeCompletedTransaction({ id: "mine", type: "income", projectedAmount: 100, scheduledDate: "2026-01-02" }),
      makeCompletedTransaction({ id: "theirs", userId: OTHER, type: "income", projectedAmount: 9_999, scheduledDate: "2026-01-02" }),
    ]);
    await migrateToInitialBalance(USER);
    expect(profile().initialBalance).toBe(400); // 500 - 100
  });
});

// ===========================================================================
// 7. OVERDUE ROWS (decision D5): counted by the risk views, never by the realized balance
// ===========================================================================

describe("an overdue, still-projected row does not move the realized balance until it is completed (D5)", () => {
  it("balance stays initial + completed while a January bill is overdue on Feb 1, then drops when it is paid", async () => {
    seedWorld();
    const overdue = occ("rent", "2026-01"); // due Jan 10, today is Feb 1
    expect(overdue.status).toBe("projected");
    expect(balance()).toBe(OPENING);
    await complete(overdue.id, 1_200);
    expect(balance()).toBe(8_800);
  });
});

// ===========================================================================
// 8. MONEY IS STORED IN CENTS; A CARD'S SCHEDULE STARTS AFTER THE PAYMENTS MADE
// ===========================================================================

describe("amounts are written in whole cents", () => {
  it("an amortized payment of 1045.5223363... is stored as 1045.52 and the balance moves by exactly that", async () => {
    seedWorld();
    store.__seedEntities("expense_rules", [
      { ...rent(), id: "emi", name: "EMI", amount: 1_045.522336346522, startDate: "2026-01-10", endDate: "2026-01-10" },
    ]);
    await complete(occ("emi", "2026-01").id, 1_045.522336346522);
    const row = rows().find((t) => t.sourceId === "emi")!;
    expect(row.actualAmount).toBe(1_045.52);
    expect(row.projectedAmount).toBe(1_045.52);
    expect(row.variance).toBe(0);
    // 10,000 - 1,045.52 = 8,954.48, no fraction of a cent
    expect(balance()).toBe(8_954.48);
  });

  it("a manual row created with a fractional amount is rounded to cents", async () => {
    seedWorld();
    const created = await addManualTransactionAction(
      { sourceType: "manual", name: "Odd", type: "expense", category: "other", projectedAmount: 10.004, actualAmount: 10.006, scheduledDate: "2026-01-14", actualDate: "2026-01-14", status: "completed" },
      USER
    );
    // 10.004 -> 10.00, 10.006 -> 10.01; the balance follows the stored actual: 10,000 - 10.01
    expect(store.__get<Transaction>("transactions", created.id)).toMatchObject({ projectedAmount: 10, actualAmount: 10.01 });
    expect(balance()).toBe(9_989.99);
  });
});

describe("a card's payoff schedule starts after the payments already made", () => {
  it("1,000 at 0% paid 400: the REMAINING 600 is billed 400 then 200, not 200 in the month just paid", async () => {
    seedWorld();
    await complete(occ("card", "2026-01").id, 400);
    expect(rule("card").creditConfig).toMatchObject({ currentBalance: 600, paymentsMade: 1 });
    // projections for the rest: Feb 25 = 400, Mar 25 = 200 (600 = 400 + 200); Jan is the stored row
    const cardRows = merged().filter((t) => t.sourceId === "card");
    expect(
      cardRows.map((t) => `${t.scheduledDate}:${t.status}:${t.status === "completed" ? t.actualAmount : t.projectedAmount}`)
    ).toEqual(["2026-01-25:completed:400", "2026-02-25:projected:400", "2026-03-25:projected:200"]);
    expect(cardRows[1].paymentBreakdown!.paymentNumber).toBe(2);
    // reverting restores the counter
    await revertTransactionToProjectedAction(rows().find((t) => t.sourceId === "card")!.id, USER);
    expect(rule("card").creditConfig).toMatchObject({ currentBalance: 1_000, paymentsMade: 0 });
  });
});

const _unused = { makeLoanConfig };
void _unused;
