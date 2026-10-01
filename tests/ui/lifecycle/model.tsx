/**
 * A tiny independent oracle of what the UI SHOULD do, plus the gesture executor used by the
 * state-machine tests. The oracle is hand-written from the spec's accounting rules:
 *
 *   balance = initialBalance + sum(signed(completed))     (income +, expense -)
 *   completing sets status=completed with the entered amount/date
 *   skipping / reverting take the transaction out of the balance
 *   revert of a rule occurrence returns it to a projection on its (possibly moved) scheduled date
 */
import { expect } from "vitest";
import { screen } from "../harness";
import {
  type App,
  addManual,
  balanceOf,
  completeTx,
  deleteManualViaModal,
  displayedBalance,
  dragToDate,
  editManual,
  invariantViolations,
  listRows,
  merged,
  revertTx,
  rowMoney,
  skipTx,
  storedUser,
} from "./kit";
import type { Transaction } from "@/lib/types";

export type Status = "projected" | "completed" | "skipped";

export interface Ent {
  key: string;
  name: string;
  kind: "rule" | "manual";
  type: "income" | "expense";
  projected: number;
  status: Status;
  actual?: number;
  sched: string;
  actualDate?: string;
  /** rule occurrence identity */
  sourceId?: string;
  occurrenceId?: string;
  /** manual transaction store id (learned after creation) */
  id?: string;
  deleted?: boolean;
}

export type Gesture =
  | { on: string; do: "complete"; amount?: number; date?: string }
  | { on: string; do: "skip" }
  | { on: string; do: "revert" }
  | { on: string; do: "reschedule"; date: string }
  | { on: string; do: "delete" }
  | {
      on: string;
      do: "edit";
      amount?: number;
      type?: "income" | "expense";
      date?: string;
      status?: Status;
    };

export const describeGesture = (g: Gesture): string => {
  const { on, do: d, ...rest } = g as Gesture & Record<string, unknown>;
  const args = Object.entries(rest)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return `${on}.${d}(${args})`;
};

export const signed = (e: Ent, amount: number): number => (e.type === "income" ? amount : -amount);

export class Model {
  ents: Record<string, Ent>;
  initialBalance: number;
  /** bystander occurrences that must stay untouched and projected */
  bystanders: { sourceId: string; occurrenceId: string; type: "income" | "expense"; amount: number; sched: string }[];

  constructor(ents: Ent[], initialBalance: number, bystanders: Model["bystanders"]) {
    this.ents = Object.fromEntries(ents.map((e) => [e.key, e]));
    this.initialBalance = initialBalance;
    this.bystanders = bystanders;
  }

  get live(): Ent[] {
    return Object.values(this.ents).filter((e) => !e.deleted);
  }

  expectedBalance(): number {
    return (
      this.initialBalance +
      this.live.reduce(
        (s, e) => s + (e.status === "completed" ? signed(e, e.actual ?? e.projected) : 0),
        0
      )
    );
  }

  /** What "the amount" of an entity is right now (actual if completed, else projected). */
  effective(e: Ent): number {
    return e.status === "completed" ? (e.actual ?? e.projected) : e.projected;
  }

  /** Which gestures the UI offers for this entity right now. */
  available(e: Ent): Gesture["do"][] {
    const base: Gesture["do"][] = ["complete", "skip", "reschedule"];
    if (e.kind === "manual") base.push("edit", "delete");
    if (e.status !== "projected") base.push("revert"); // stored rows only
    if (e.kind === "manual" && e.status === "projected") {
      /* manual projected rows are stored, revert is not offered for them */
    }
    return base;
  }

  update(g: Gesture): void {
    const e = this.ents[g.on];
    switch (g.do) {
      case "complete": {
        const amt = g.amount ?? (e.status === "completed" ? e.actual! : e.projected);
        // REWRITTEN (MANUAL-k): the dialog's Actual Date defaults to today for a bill scheduled in the
        // future (paying early happens today), to the scheduled date otherwise. The kit's clock is 2026-01-15.
        const dt =
          g.date ??
          (e.status === "completed" ? e.actualDate! : e.sched > "2026-01-15" ? "2026-01-15" : e.sched);
        e.status = "completed";
        e.actual = amt;
        e.actualDate = dt;
        return;
      }
      case "skip":
        e.status = "skipped";
        e.actual = undefined;
        e.actualDate = undefined;
        return;
      case "revert":
        e.status = "projected";
        e.actual = undefined;
        e.actualDate = undefined;
        return;
      case "reschedule":
        e.sched = g.date;
        if (e.status === "completed") e.actualDate = g.date;
        return;
      case "delete":
        e.deleted = true;
        return;
      case "edit": {
        const wasCompleted = e.status === "completed";
        if (g.type) e.type = g.type;
        if (g.date) e.sched = g.date;
        if (g.amount !== undefined) e.projected = g.amount;
        if (g.status) e.status = g.status;
        if (e.status === "completed") {
          e.actual = g.amount ?? e.actual ?? e.projected;
          // REWRITTEN (MANUAL-k): the form only re-dates the actual when the date changed or the row becomes
          // completed (ManualTransactionForm/formHelpers); a row completed early keeps its actual date
          // (today), which no longer equals the scheduled date.
          if (g.date || !wasCompleted) e.actualDate = e.sched;
        } else {
          e.actual = undefined;
          e.actualDate = undefined;
        }
        return;
      }
    }
  }
}

/** The merged transaction that corresponds to a model entity. */
export const txOf = (app: App, e: Ent): Transaction | undefined =>
  e.kind === "manual"
    ? merged(app).find((t) => t.id === e.id)
    : merged(app).find((t) => t.sourceId === e.sourceId && t.occurrenceId === e.occurrenceId);

/** Run one gesture through the real UI. */
export async function perform(app: App, model: Model, g: Gesture): Promise<void> {
  const e = model.ents[g.on];
  const tx = txOf(app, e);
  expect(tx, `no merged transaction for ${e.key} before ${describeGesture(g)}`).toBeTruthy();
  switch (g.do) {
    case "complete":
      await completeTx(app, tx!.id, { amount: g.amount, date: g.date });
      break;
    case "skip":
      await skipTx(app, tx!.id);
      break;
    case "revert":
      await revertTx(app, tx!.id);
      break;
    case "reschedule":
      await dragToDate(app, tx!.id, g.date);
      break;
    case "delete":
      await deleteManualViaModal(app, tx!.id);
      break;
    case "edit":
      await editManual(app, tx!.id, {
        amount: g.amount,
        type: g.type,
        date: g.date,
        status: g.status,
      });
      break;
  }
}

/** Every disagreement between the model, the store, the merged list and the rows on screen. */
export interface CheckOpts {
  /**
   * Skip the per-row amount/date comparison for rows that are NOT completed. Used by the
   * regression-guard random walks so the documented "stale actualAmount/actualDate" defect
   * (UI-LIFE-04/05) does not mask every other finding.
   */
  ignoreStale?: boolean;
}

export function modelViolations(app: App, model: Model, opts: CheckOpts = {}): string[] {
  const out: string[] = [];
  const m = merged(app);

  for (const e of model.live) {
    const tx = txOf(app, e);
    if (!tx) {
      out.push(`M0 ${e.key}: missing from merged`);
      continue;
    }
    if (tx.status !== e.status) out.push(`M1 ${e.key}: status ${tx.status}, expected ${e.status}`);
    if (tx.type !== e.type) out.push(`M1 ${e.key}: type ${tx.type}, expected ${e.type}`);
    const shownDate = tx.actualDate || tx.scheduledDate;
    const wantDate = e.status === "completed" ? e.actualDate! : e.sched;
    const stale = opts.ignoreStale && e.status !== "completed";
    if (!stale && shownDate !== wantDate) {
      out.push(`M1 ${e.key}: date ${shownDate}, expected ${wantDate}`);
    }
    if (tx.scheduledDate !== e.sched) {
      out.push(`M1 ${e.key}: scheduledDate ${tx.scheduledDate}, expected ${e.sched}`);
    }
    const want = signed(e, model.effective(e));
    if (stale) continue;
    try {
      const shown = rowMoney(app, tx.id)[0];
      if (Math.round(shown * 100) !== Math.round(want * 100)) {
        out.push(`R1 ${e.key}: row prints ${shown}, expected ${want}`);
      }
    } catch (err) {
      out.push(`R1 ${e.key}: row unreadable (${(err as Error).message.split("\n")[0]})`);
    }
  }
  for (const b of model.bystanders) {
    const tx = m.find((t) => t.sourceId === b.sourceId && t.occurrenceId === b.occurrenceId);
    if (!tx) out.push(`M0 bystander ${b.occurrenceId} missing`);
    else if (tx.status !== "projected" || tx.scheduledDate !== b.sched) {
      out.push(`M2 bystander ${b.occurrenceId} disturbed: ${tx.status} ${tx.scheduledDate}`);
    }
  }
  const expectRows = model.live.length + model.bystanders.length;
  if (m.length !== expectRows) out.push(`M3 merged has ${m.length} rows, expected ${expectRows}`);
  if (listRows().length !== Math.min(m.length, listRows().length)) out.push("M4 row count");
  const heading = screen
    .getAllByText(/^Transactions \(\d+\)$/)
    .find((el) => el.tagName === "H3");
  if (heading && heading.textContent !== `Transactions (${m.length})`) {
    out.push(`R2 list header ${heading.textContent}, merged has ${m.length}`);
  }

  const bal = balanceOf(app);
  const wantBal = model.expectedBalance();
  if (Math.round(bal * 100) !== Math.round(wantBal * 100)) {
    out.push(`B1 stored balance ${bal}, model expects ${wantBal}`);
  }
  try {
    const shown = displayedBalance();
    if (Math.round(shown * 100) !== Math.round(wantBal * 100)) {
      out.push(`B2 screen balance ${shown}, model expects ${wantBal}`);
    }
  } catch (err) {
    out.push(`B2 screen balance unreadable: ${(err as Error).message}`);
  }
  return out;
}

export const allViolations = (app: App, model: Model, opts: CheckOpts = {}): string[] => [
  ...invariantViolations(app),
  ...modelViolations(app, model, opts),
];

/** Apply a gesture through the UI and the model, then report violations with the trace. */
export async function step(
  app: App,
  model: Model,
  g: Gesture,
  trace: string[],
  opts: CheckOpts = {}
): Promise<string[]> {
  await perform(app, model, g);
  model.update(g);
  trace.push(describeGesture(g));
  return allViolations(app, model, opts);
}

export { addManual, storedUser };
