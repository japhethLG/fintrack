import { assert, describe, expect, it } from "vitest";
import { makeExpenseRule, makeIncomeSource, makeManualTransaction, knownDefect } from "../harness";
import { mountAll, type App } from "./kit";
import { Ent, Gesture, Model, allViolations, describeGesture, step } from "./model";

/**
 * STATE MACHINE over the real Transactions list + TransactionModal + manual form + Calendar drag.
 *
 * Fixture (today 2026-01-15, initial = current balance = 10,000, USD):
 *   Salary   income  monthly 3,000  Jan 10 and Feb 10   (rule occurrences sal_2026-01 / sal_2026-02)
 *   Rent     expense monthly 1,200  Jan 12 and Feb 12   (rent_2026-01 / rent_2026-02)
 *   Coffee   manual  expense 50     Jan 20, projected   (stored, id m1)
 * The Feb occurrences are bystanders: they must never change.
 *
 * After EVERY gesture the following must hold (see kit.invariantViolations / model.modelViolations):
 *   I1  stored users/{uid}.currentBalance == initialBalance + sum(signed(completed stored))
 *   I2  each stored transaction appears exactly once in merged; merged ids unique; no duplicate occurrence
 *   I3  the balance the Settings card prints equals the stored balance, no "mismatch" warning
 *   M/R the merged row + the list row agree with an independent hand-written model
 *   B   stored + printed balance equal the MODEL's balance (not derived from stored docs)
 */

const fixture = () => ({
  seed: {
    incomeSources: [
      makeIncomeSource({
        id: "sal",
        name: "Salary",
        amount: 3_000,
        startDate: "2026-01-10",
        endDate: "2026-02-10",
      }),
    ],
    expenseRules: [
      makeExpenseRule({
        id: "rent",
        name: "Rent",
        amount: 1_200,
        startDate: "2026-01-12",
        endDate: "2026-02-12",
      }),
    ],
    transactions: [
      makeManualTransaction({
        id: "m1",
        name: "Coffee",
        type: "expense",
        category: "dining",
        projectedAmount: 50,
        scheduledDate: "2026-01-20",
        status: "projected",
      }),
    ],
  },
  model: () => {
    const ents: Ent[] = [
      {
        key: "sal",
        name: "Salary",
        kind: "rule",
        type: "income",
        projected: 3_000,
        status: "projected",
        sched: "2026-01-10",
        sourceId: "sal",
        occurrenceId: "sal_2026-01",
      },
      {
        key: "rent",
        name: "Rent",
        kind: "rule",
        type: "expense",
        projected: 1_200,
        status: "projected",
        sched: "2026-01-12",
        sourceId: "rent",
        occurrenceId: "rent_2026-01",
      },
      {
        key: "coffee",
        name: "Coffee",
        kind: "manual",
        type: "expense",
        projected: 50,
        status: "projected",
        sched: "2026-01-20",
        id: "m1",
      },
    ];
    return new Model(ents, 10_000, [
      { sourceId: "sal", occurrenceId: "sal_2026-02", type: "income", amount: 3_000, sched: "2026-02-10" },
      { sourceId: "rent", occurrenceId: "rent_2026-02", type: "expense", amount: 1_200, sched: "2026-02-12" },
    ]);
  },
});

async function boot(): Promise<{ app: App; model: Model; trace: string[] }> {
  const f = fixture();
  const app = await mountAll(f.seed);
  const model = f.model();
  const trace: string[] = [];
  expect(allViolations(app, model), "fixture must satisfy every invariant before any gesture").toEqual([]);
  return { app, model, trace };
}

/** Run a path; assert the invariants after EVERY step, reporting the whole gesture sequence. */
async function walk(gestures: Gesture[]): Promise<{ app: App; model: Model }> {
  const { app, model, trace } = await boot();
  for (const g of gestures) {
    const v = await step(app, model, g, trace);
    if (v.length > 0) assert.fail(`after ${trace.join("  ->  ")}:\n  ${v.join("\n  ")}`);
  }
  return { app, model };
}

const T = 60_000;

// ---------------------------------------------------------------------------
// Rule occurrences: income (Salary) and expense (Rent)
// ---------------------------------------------------------------------------
describe.each([
  { key: "sal", label: "income rule (Salary)", amt: 3_250.5, alt: 2_900 },
  { key: "rent", label: "expense rule (Rent)", amt: 1_275.25, alt: 1_100 },
])("state machine: $label", ({ key, amt, alt }) => {
  const on = key;
  const C = (amount?: number, date?: string): Gesture => ({ on, do: "complete", amount, date });
  const S: Gesture = { on, do: "skip" };
  const R: Gesture = { on, do: "revert" };
  const MV = (date: string): Gesture => ({ on, do: "reschedule", date });

  // ---- from PROJECTED
  it("projected -> completed (default amount/date)", () => walk([C()]), T);
  it("projected -> completed with a changed amount", () => walk([C(amt)]), T);
  it("projected -> completed on a different date (same month)", () => walk([C(undefined, "2026-01-25")]), T);
  it("projected -> completed with changed amount AND date", () => walk([C(amt, "2026-01-05")]), T);
  it("projected -> completed on a date in a different month", () => walk([C(amt, "2026-02-03")]), T);
  it("projected -> skipped", () => walk([S]), T);
  it("projected -> rescheduled (drag)", () => walk([MV("2026-01-22")]), T);

  // ---- from COMPLETED
  it("completed -> re-completed with a new amount", () => walk([C(amt), C(alt)]), T);
  it("completed -> re-completed with a new date", () => walk([C(amt), C(undefined, "2026-01-28")]), T);
  it(
    "UI-LIFE-04 — completed -> skipped: the skipped row keeps printing the old actual amount", async () => { await walk([C(amt), S]); }, T);
  it("completed -> reverted", () => walk([C(amt), R]), T);
  it("completed -> rescheduled (drag)", () => walk([C(amt), MV("2026-01-27")]), T);

  // ---- from SKIPPED
  it("skipped -> completed", () => walk([S, C(amt)]), T);
  it("skipped -> reverted", () => walk([S, R]), T);
  it("skipped -> skipped again", () => walk([S, S]), T);
  it("skipped -> rescheduled (drag)", () => walk([S, MV("2026-01-23")]), T);

  // ---- cycles
  it("complete -> revert -> complete cycle", () => walk([C(amt), R, C(alt)]), T);
  it("reschedule -> complete -> revert keeps the moved date", () => walk([MV("2026-01-22"), C(amt), R]), T);
  it("skip -> revert -> skip -> complete -> revert", () => walk([S, R, S, C(alt), R]), T);
});

// ---------------------------------------------------------------------------
// Manual transaction (Coffee)
// ---------------------------------------------------------------------------
describe("state machine: manual transaction (Coffee)", () => {
  const on = "coffee";
  const C = (amount?: number, date?: string): Gesture => ({ on, do: "complete", amount, date });
  const S: Gesture = { on, do: "skip" };
  const R: Gesture = { on, do: "revert" };
  const D: Gesture = { on, do: "delete" };
  const E = (o: { amount?: number; type?: "income" | "expense"; date?: string; status?: "projected" | "completed" | "skipped" }): Gesture => ({
    on,
    do: "edit",
    ...o,
  });

  // ---- from PROJECTED
  it("projected -> completed (default)", () => walk([C()]), T);
  it("projected -> completed with changed amount", () => walk([C(64.5)]), T);
  it("projected -> completed on a different date", () => walk([C(undefined, "2026-01-18")]), T);
  it("projected -> skipped", () => walk([S]), T);
  it("projected -> deleted", () => walk([D]), T);
  it("projected -> edited: amount", () => walk([E({ amount: 75 })]), T);
  it("projected -> edited: type flipped to income", () => walk([E({ type: "income", amount: 50 })]), T);
  it("projected -> edited: date moved", () => walk([E({ date: "2026-01-26", amount: 50 })]), T);
  it("projected -> edited: status set to completed", () => walk([E({ status: "completed", amount: 50 })]), T);
  it("projected -> edited: status set to skipped", () => walk([E({ status: "skipped", amount: 50 })]), T);
  it("projected -> rescheduled (drag)", () => walk([{ on, do: "reschedule", date: "2026-01-24" }]), T);

  // ---- from COMPLETED
  it("completed -> re-completed with new amount", () => walk([C(64.5), C(80)]), T);
  it(
    "UI-LIFE-04 — completed -> skipped: row keeps printing the old actual amount", async () => { await walk([C(64.5), S]); }, T);
  it(
    "UI-LIFE-04 — completed -> reverted (modal): row keeps printing the old actual amount", async () => { await walk([C(64.5), R]); }, T);
  it("completed -> deleted", () => walk([C(64.5), D]), T);
  it("completed -> edited: amount", () => walk([C(64.5), E({ amount: 90 })]), T);
  it(
    "UI-LIFE-01 — completed -> edited: type flipped leaves the balance unchanged", async () => { await walk([C(64.5), E({ type: "income", amount: 64.5 })]); }, T);
  it(
    "UI-LIFE-02 — completed -> edited: type flipped AND amount changed adjusts the balance with the wrong sign", async () => { await walk([C(64.5), E({ type: "income", amount: 70 })]); }, T);
  it(
    "UI-LIFE-04 — completed -> edited (form): status back to projected keeps the old actual amount", async () => { await walk([C(64.5), E({ status: "projected", amount: 50 })]); }, T);
  it(
    "UI-LIFE-04 — completed -> edited (form): status to skipped keeps the old actual amount", async () => { await walk([C(64.5), E({ status: "skipped", amount: 50 })]); }, T);
  it("completed -> rescheduled (drag)", () => walk([C(64.5), { on, do: "reschedule", date: "2026-01-19" }]), T);

  // ---- from SKIPPED
  it("skipped -> completed", () => walk([S, C(64.5)]), T);
  it("skipped -> reverted", () => walk([S, R]), T);
  it("skipped -> deleted", () => walk([S, D]), T);
  it("skipped -> edited: status to completed", () => walk([S, E({ status: "completed", amount: 55 })]), T);
  it("skipped -> edited: type flipped", () => walk([S, E({ type: "income", amount: 50 })]), T);

  // ---- cycles
  it(
    "UI-LIFE-04 — complete -> revert -> complete: the reverted row prints the old actual amount", async () => { await walk([C(64.5), R, C(80)]); }, T);
  it(
    "UI-LIFE-04 — complete -> skip -> complete: the skipped row prints the old actual amount", async () => { await walk([C(64.5), S, C(70)]); }, T);
  it(
    "UI-LIFE-01 — complete -> edit(type flip) -> delete: balance is wrong after the flip", async () => { await walk([C(64.5), E({ type: "income", amount: 64.5 }), D]); }, T);
});

// ---------------------------------------------------------------------------
// Everything together, deterministic pseudo-random walks
// ---------------------------------------------------------------------------

/** mulberry32: tiny seeded PRNG, so a failing sequence can be replayed exactly. */
const rng = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const AMOUNTS = [10, 99.99, 120.5, 1_000, 1_275.25, 2_900, 3_250.5];
const JAN_DATES = ["2026-01-05", "2026-01-11", "2026-01-14", "2026-01-18", "2026-01-22", "2026-01-27", "2026-01-29"];

interface WalkOpts {
  seed: number;
  steps: number;
  /** tolerate the stale-actual defect on non-completed rows (see model.CheckOpts) */
  ignoreStale?: boolean;
  /** restrict the gesture vocabulary */
  allow: (g: Gesture["do"], e: Ent) => boolean;
}

/** Choose the next gesture from what the UI offers for a random live entity. */
function pick(model: Model, rand: () => number, opts: WalkOpts): Gesture | null {
  const live = model.live;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const e = live[Math.floor(rand() * live.length)];
    const options = model.available(e).filter((d) => opts.allow(d, e));
    if (options.length === 0) continue;
    const d = options[Math.floor(rand() * options.length)];
    const amount = AMOUNTS[Math.floor(rand() * AMOUNTS.length)];
    const date = JAN_DATES[Math.floor(rand() * JAN_DATES.length)];
    switch (d) {
      case "complete":
        // explicit amount always; date half of the time
        return { on: e.key, do: "complete", amount, date: rand() < 0.5 ? date : undefined };
      case "skip":
      case "revert":
      case "delete":
        return { on: e.key, do: d };
      case "reschedule": {
        const cur = e.status === "completed" ? e.actualDate! : e.sched;
        return { on: e.key, do: "reschedule", date: date === cur ? "2026-01-30" : date };
      }
      case "edit": {
        const flip = rand() < 0.4;
        return {
          on: e.key,
          do: "edit",
          amount,
          type: flip ? (e.type === "income" ? "expense" : "income") : undefined,
          date: rand() < 0.3 ? date : undefined,
          status: rand() < 0.3 ? (["projected", "completed", "skipped"] as const)[Math.floor(rand() * 3)] : undefined,
        };
      }
    }
  }
  return null;
}

async function randomWalk(opts: WalkOpts): Promise<string[]> {
  const { app, model, trace } = await boot();
  const rand = rng(opts.seed);
  for (let i = 0; i < opts.steps; i += 1) {
    const g = pick(model, rand, opts);
    if (!g) break;
    const v = await step(app, model, g, trace, { ignoreStale: opts.ignoreStale });
    if (v.length > 0) {
      assert.fail(
        `seed ${opts.seed}: invariants violated at step ${i + 1}/${opts.steps}\n` +
          `violations:\n  ${v.join("\n  ")}\n` +
          `gesture sequence:\n  ${trace.map((t, n) => `${n + 1}. ${t}`).join("\n  ")}`
      );
    }
  }
  return trace;
}

describe("seeded random walks (30 gestures, invariants after every step)", () => {
  // Regression guards: the manual Edit form is excluded (type flips are UI-LIFE-01/02) and the
  // stale-actual row defect (UI-LIFE-04/05) is tolerated on non-completed rows, so everything
  // else - balance, statuses, ids, duplicates - is checked after every one of the 30 gestures.
  const safe: WalkOpts["allow"] = (d, e) => !(e.kind === "manual" && d === "edit");
  it.each([1, 7, 2026])("rule + manual gestures except manual Edit, seed %i", async (seed) => {
    const trace = await randomWalk({ seed, steps: 30, allow: safe, ignoreStale: true });
    expect(trace.length).toBe(30);
  }, 240_000);

  it.each([3, 11])("rule occurrences only (all gestures), seed %i", async (seed) => {
    const trace = await randomWalk({ seed, steps: 30, allow: (_d, e) => e.kind === "rule", ignoreStale: true });
    expect(trace.length).toBe(30);
  }, 240_000);

  it(
    "UI-LIFE-WALK — the unrestricted, strict random walk (manual Edit included, stale rows NOT tolerated) violates an invariant",
    async () => {
      const trace = await randomWalk({ seed: 5, steps: 30, allow: () => true });
      expect(trace.length).toBe(30);
    },
    240_000
  );
});
