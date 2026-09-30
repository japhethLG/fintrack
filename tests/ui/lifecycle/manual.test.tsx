import { describe, expect, it, vi } from "vitest";
import {
  screen,
  within,
  waitFor,
  knownDefect,
  makeCompletedTransaction,
  makeExpenseRule,
  makeManualTransaction,
} from "../harness";
import {
  addManual,
  balanceOf,
  completeTx,
  deleteManualViaModal,
  displayedBalance,
  editManual,
  expectInvariants,
  fillManualForm,
  mountTx,
  nth,
  openTx,
  revertTx,
  rowMoney,
  skipTx,
  storedTxs,
} from "./kit";
import type { Transaction } from "@/lib/types";

/**
 * Manual transactions through the real UI: Add Transaction form, TransactionModal
 * (Complete / Skip / Revert / Delete) and the Edit form.
 *
 * Accounting rule used for every expectation (SPECIFICATION 3.4 "Balance Updates"):
 *   currentBalance = initialBalance + sum(income completed) - sum(expense completed)
 * Fixture default: initial = current = 10,000 unless a test seeds a completed row, in which case
 * currentBalance is seeded consistently (10,000 - 100 = 9,900 for a completed 100 expense).
 */

const T = 60_000;

/** A completed manual expense of 100 that the balance already reflects: 10,000 - 100. */
const completedExpense = (over: Partial<Transaction> = {}) =>
  makeCompletedTransaction({
    id: "m1",
    sourceType: "manual",
    name: "Groceries",
    type: "expense",
    category: "groceries",
    projectedAmount: 100,
    actualAmount: 100,
    scheduledDate: "2026-01-12",
    actualDate: "2026-01-12",
    ...over,
  });

const projectedManual = (over: Partial<Transaction> = {}) =>
  makeManualTransaction({
    id: "m1",
    name: "Groceries",
    type: "expense",
    category: "groceries",
    projectedAmount: 100,
    scheduledDate: "2026-01-20",
    status: "projected",
    ...over,
  });

describe("manual transactions: balance accounting that works today", () => {
  it("completing a projected expense with a different amount debits the ACTUAL amount", async () => {
    // 10,000 - 118.50 = 9,881.50
    const app = await mountTx({ transactions: [projectedManual()] });
    expect(balanceOf(app)).toBe(10_000);
    await completeTx(app, "m1", { amount: 118.5 });
    expect(balanceOf(app)).toBe(9_881.5);
    expect(displayedBalance()).toBe(9_881.5);
    expectInvariants(app, ["complete(118.5)"]);
  }, T);

  it("completing a projected INCOME credits the balance", async () => {
    // 10,000 + 250 = 10,250
    const app = await mountTx({
      transactions: [projectedManual({ type: "income", projectedAmount: 250, category: "gift" })],
    });
    await completeTx(app, "m1");
    expect(balanceOf(app)).toBe(10_250);
    expect(displayedBalance()).toBe(10_250);
  }, T);

  it("skipping a completed manual expense gives the money back (9,900 -> 10,000)", async () => {
    const app = await mountTx({
      profile: { currentBalance: 9_900 },
      transactions: [completedExpense()],
    });
    expect(displayedBalance()).toBe(9_900);
    await skipTx(app, "m1");
    expect(balanceOf(app)).toBe(10_000);
    expect(displayedBalance()).toBe(10_000);
    expect(storedTxs(app)[0].status).toBe("skipped");
  }, T);

  it("deleting a completed manual expense through the modal gives the money back", async () => {
    const app = await mountTx({
      profile: { currentBalance: 9_900 },
      transactions: [completedExpense()],
    });
    await deleteManualViaModal(app, "m1");
    expect(storedTxs(app)).toHaveLength(0);
    expect(balanceOf(app)).toBe(10_000);
    expect(displayedBalance()).toBe(10_000);
  }, T);

  it("deleting a still-projected manual transaction does not touch the balance", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    await deleteManualViaModal(app, "m1");
    expect(storedTxs(app)).toHaveLength(0);
    expect(balanceOf(app)).toBe(10_000);
  }, T);

  it("editing the amount of a completed expense (100 -> 130) debits only the difference", async () => {
    // 9,900 - 30 = 9,870
    const app = await mountTx({
      profile: { currentBalance: 9_900 },
      transactions: [completedExpense()],
    });
    await editManual(app, "m1", { amount: 130 });
    expect(storedTxs(app)[0]).toMatchObject({ projectedAmount: 130, actualAmount: 130 });
    expect(balanceOf(app)).toBe(9_870);
    expect(displayedBalance()).toBe(9_870);
  }, T);

  it("Edit form: projected -> completed applies the amount, completed -> skipped reverses it", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    await editManual(app, "m1", { status: "completed", amount: 100 });
    expect(balanceOf(app)).toBe(9_900);
    await editManual(app, "m1", { status: "skipped", amount: 100 });
    expect(balanceOf(app)).toBe(10_000);
    expectInvariants(app, ["edit->completed", "edit->skipped"]);
  }, T);

  it("Edit form's own Delete button: confirm(true) deletes and reverses, confirm(false) does nothing", async () => {
    const app = await mountTx({
      profile: { currentBalance: 9_900 },
      transactions: [completedExpense()],
    });
    const confirm = vi.spyOn(window, "confirm");
    const openForm = async () => {
      const dlg = await openTx(app, "m1");
      await app.user.click(within(dlg).getByRole("button", { name: /^editEdit$/ }));
      await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1));
      const form = await screen.findByRole("dialog");
      await within(form).findByLabelText(/^Name/);
      return form;
    };

    confirm.mockReturnValue(false);
    let form = await openForm();
    await app.user.click(within(form).getByRole("button", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storedTxs(app)).toHaveLength(1);
    expect(balanceOf(app)).toBe(9_900);
    await app.user.click(within(form).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    confirm.mockReturnValue(true);
    form = await openForm();
    await app.user.click(within(form).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await app.settle();
    expect(storedTxs(app)).toHaveLength(0);
    expect(balanceOf(app)).toBe(10_000);
    confirm.mockRestore();
  }, T);

  it("Cancel in the Complete modal writes nothing", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    const before = app.store.__ops.length;
    const dlg = await openTx(app, "m1");
    await app.user.clear(within(dlg).getByLabelText(/Actual Amount/));
    await app.user.type(within(dlg).getByLabelText(/Actual Amount/), "77");
    await app.user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(app.store.__ops.length).toBe(before);
    expect(balanceOf(app)).toBe(10_000);
  }, T);
});

describe("manual transaction form validation", () => {
  it("rejects a zero amount and writes nothing", async () => {
    const app = await mountTx({});
    await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/^Name/);
    await fillManualForm(app, dialog, { name: "Zero", amount: 0 });
    await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));
    expect(await within(dialog).findByText("Amount must be greater than 0")).toBeInTheDocument();
    expect(storedTxs(app)).toHaveLength(0);
  }, T);

  it("rejects a negative amount and a missing name", async () => {
    const app = await mountTx({});
    await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText(/^Name/);
    await fillManualForm(app, dialog, { amount: -5 });
    await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));
    expect(await within(dialog).findByText("Amount must be greater than 0")).toBeInTheDocument();
    expect(await within(dialog).findByText("Name is required")).toBeInTheDocument();
    expect(storedTxs(app)).toHaveLength(0);
  }, T);
});

// ---------------------------------------------------------------------------
// Hypotheses from the audit docs, verified through the UI
// ---------------------------------------------------------------------------

describe("manual transactions: type flip on a completed row", () => {
  it(
    "UI-LIFE-01 — flipping a completed manual expense to income (same amount) leaves the balance unchanged",
    async () => {
      // observed: balance stays 9,900 (updateManualTransactionAction only adjusts when the amount
      // differs and always uses the EXISTING type). Correct: a 100 expense that becomes a 100
      // income moves the balance by +200: 9,900 -> 10,100.
      const app = await mountTx({
        profile: { currentBalance: 9_900 },
        transactions: [completedExpense()],
      });
      await editManual(app, "m1", { type: "income" });
      expect(storedTxs(app)[0]).toMatchObject({ type: "income", status: "completed", actualAmount: 100 });
      expect(balanceOf(app)).toBe(10_100);
    },
    T
  );

  it(
    "UI-LIFE-02 — flipping type AND changing the amount of a completed manual row adjusts by the wrong sign",
    async () => {
      // 100 expense -> 130 income. Correct: 9,900 + 100 (undo expense) + 130 = 10,130.
      // observed: 9,870 (treated as still an expense: -(130-100)).
      const app = await mountTx({
        profile: { currentBalance: 9_900 },
        transactions: [completedExpense()],
      });
      await editManual(app, "m1", { type: "income", amount: 130 });
      expect(storedTxs(app)[0]).toMatchObject({ type: "income", actualAmount: 130 });
      expect(balanceOf(app)).toBe(10_130);
    },
    T
  );

  it(
    "UI-LIFE-02b — the SCREEN balance after a type flip disagrees with the row (Settings card shows the stale number)",
    async () => {
      // same root cause as UI-LIFE-01, asserted on what the user reads: the balance card must
      // equal 10,000 - (nothing completed as expense) + 100 income = 10,100.
      const app = await mountTx({
        profile: { currentBalance: 9_900 },
        transactions: [completedExpense()],
      });
      await editManual(app, "m1", { type: "income" });
      expect(rowMoney(app, "m1")[0]).toBe(100); // row now prints +$100.00 (income)
      expect(displayedBalance()).toBe(10_100);
    },
    T
  );
});

describe("manual transactions: created as Completed", () => {
  it(
    "UI-LIFE-03 — Add Transaction with Status=Completed does not move the balance",
    async () => {
      // observed: 10,000 stays 10,000. Correct: a completed 40 expense -> 9,960.
      const app = await mountTx({});
      await addManual(app, {
        name: "Lunch",
        amount: 40,
        date: "2026-01-14",
        type: "expense",
        status: "completed",
      });
      expect(storedTxs(app)).toHaveLength(1);
      expect(storedTxs(app)[0]).toMatchObject({ status: "completed", actualAmount: 40, type: "expense" });
      expect(balanceOf(app)).toBe(9_960);
      expect(displayedBalance()).toBe(9_960);
    },
    T
  );

  it(
    "UI-LIFE-03b — add-as-completed then delete leaves the balance HIGHER than it started (delete reverses a debit that never happened)",
    async () => {
      // observed: create completed 40 (no debit) then delete (+40 credit) -> 10,040 instead of 10,000.
      const app = await mountTx({});
      await addManual(app, {
        name: "Lunch",
        amount: 40,
        date: "2026-01-14",
        type: "expense",
        status: "completed",
      });
      expect(storedTxs(app)).toHaveLength(1);
      await deleteManualViaModal(app, nth(app, "Lunch", 0).id);
      expect(storedTxs(app)).toHaveLength(0);
      expect(balanceOf(app)).toBe(10_000);
    },
    T
  );

  it("Add Transaction with Status=Skipped or Projected never moves the balance", async () => {
    const app = await mountTx({});
    await addManual(app, { name: "Maybe", amount: 40, status: "projected" });
    await addManual(app, { name: "Cancelled", amount: 15, status: "skipped" });
    expect(storedTxs(app)).toHaveLength(2);
    expect(balanceOf(app)).toBe(10_000);
  }, T);
});

describe("manual transactions: leaving the Completed state keeps stale actual fields", () => {
  it(
    "UI-LIFE-04 — reverting a completed manual row to projected keeps its old actualAmount, so a projected row prints the paid amount",
    async () => {
      // seed: projected 100, actually paid 120; balance already reflects 120 (9,880).
      // observed: after Revert the balance is right (10,000) but the doc keeps actualAmount 120 and
      // the list prints -$120.00 for a row that is only PROJECTED at 100.
      const app = await mountTx({
        profile: { currentBalance: 9_880 },
        transactions: [completedExpense({ projectedAmount: 100, actualAmount: 120 })],
      });
      await revertTx(app, "m1");
      expect(balanceOf(app)).toBe(10_000); // the reversal itself is right
      expect(storedTxs(app)[0].status).toBe("projected");
      expect(rowMoney(app, "m1")[0]).toBe(-100);
    },
    T
  );

  it(
    "UI-LIFE-04b — Edit form: completed -> projected keeps the old actualAmount (same defect through the other UI path)",
    async () => {
      const app = await mountTx({
        profile: { currentBalance: 9_880 },
        transactions: [completedExpense({ projectedAmount: 100, actualAmount: 120 })],
      });
      await editManual(app, "m1", { status: "projected", amount: 100 });
      expect(balanceOf(app)).toBe(10_000);
      expect(storedTxs(app)[0]).toMatchObject({ status: "projected", projectedAmount: 100 });
      expect(rowMoney(app, "m1")[0]).toBe(-100);
    },
    T
  );

  it(
    "UI-LIFE-05 — skipping a completed transaction keeps its actualDate, so the skipped row stays on the day it was 'paid'",
    async () => {
      // seed: scheduled Jan 12, paid on Jan 14. After Skip the transaction must sit on its scheduled day.
      // observed: merged/list/calendar place it on actualDate 2026-01-14.
      const app = await mountTx({
        profile: { currentBalance: 9_900 },
        transactions: [completedExpense({ scheduledDate: "2026-01-12", actualDate: "2026-01-14" })],
      });
      await skipTx(app, "m1");
      expect(balanceOf(app)).toBe(10_000);
      const t = storedTxs(app)[0];
      expect(t).toMatchObject({ status: "skipped", scheduledDate: "2026-01-12" });
      expect(t.actualDate ?? t.scheduledDate).toBe("2026-01-12");
    },
    T
  );
});

describe("manual transactions: the Edit form rewrites fields the user did not touch", () => {
  it(
    "UI-LIFE-06 — saving only a note on a completed row overwrites projectedAmount with the actual amount (variance lost)",
    async () => {
      // seed: projected 100, actual 120 (variance +20). Edit only the notes.
      // observed: projectedAmount becomes 120 because the form pre-fills 'amount' with actualAmount.
      const app = await mountTx({
        profile: { currentBalance: 9_880 },
        transactions: [completedExpense({ projectedAmount: 100, actualAmount: 120, variance: 20 })],
      });
      await editManual(app, "m1", { notes: "receipt filed" });
      const t = storedTxs(app)[0];
      expect(t.notes).toBe("receipt filed");
      expect(balanceOf(app)).toBe(9_880); // unchanged, as it must be
      expect(t.actualAmount).toBe(120);
      expect(t.projectedAmount).toBe(100);
    },
    T
  );

  it(
    "UI-LIFE-06b — saving only a note on a completed row resets actualDate to the scheduled date",
    async () => {
      // seed: scheduled Jan 12, paid Jan 14. observed: actualDate becomes 2026-01-12.
      const app = await mountTx({
        profile: { currentBalance: 9_900 },
        transactions: [completedExpense({ scheduledDate: "2026-01-12", actualDate: "2026-01-14" })],
      });
      await editManual(app, "m1", { notes: "paid late" });
      const t = storedTxs(app)[0];
      expect(t.notes).toBe("paid late");
      expect(t.scheduledDate).toBe("2026-01-12");
      expect(t.actualDate).toBe("2026-01-14");
    },
    T
  );
});

describe("variance and notes", () => {
  it("the Complete modal previews the variance while typing (actual 120 vs expected 100)", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    const dlg = await openTx(app, "m1");
    const amount = within(dlg).getByLabelText(/Actual Amount/);
    await app.user.clear(amount);
    await app.user.type(amount, "120");
    expect(await within(dlg).findByText(/\+\$20(\.00)? variance from expected/)).toBeInTheDocument();
  }, T);

  it(
    "UI-LIFE-07 — completing a manual transaction never stores `variance`, so the list shows no variance line",
    async () => {
      // observed: stored doc has no `variance`; row prints only -$120.00. The modal preview showed +$20.00.
      const app = await mountTx({ transactions: [projectedManual()] });
      await completeTx(app, "m1", { amount: 120 });
      const t = storedTxs(app)[0];
      expect(t).toMatchObject({ status: "completed", actualAmount: 120, projectedAmount: 100 });
      expect(t.variance).toBe(20);
      expect(rowMoney(app, "m1")).toEqual([-120, 20]);
    },
    T
  );

  it("notes typed in the Complete modal are stored and pre-filled when the row is reopened", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    await completeTx(app, "m1", { notes: "paid by card" });
    expect(storedTxs(app)[0].notes).toBe("paid by card");
    const dlg = await openTx(app, "m1");
    expect((within(dlg).getByLabelText(/Notes/) as HTMLInputElement).value).toBe("paid by card");
  }, T);

  it(
    "UI-LIFE-08 — a note cannot be removed: clearing the field and saving keeps the old note (undefined is dropped, not deleted)",
    async () => {
      // observed: stored notes stay "paid by card" after re-completing with an empty Notes field.
      const app = await mountTx({ transactions: [projectedManual()] });
      await completeTx(app, "m1", { notes: "paid by card" });
      expect(storedTxs(app)[0].notes).toBe("paid by card");
      await completeTx(app, "m1", { notes: "" });
      expect(storedTxs(app)[0].status).toBe("completed");
      expect(storedTxs(app)[0].notes ?? "").toBe("");
    },
    T
  );

  it(
    "UI-LIFE-08b — Edit form: clearing the Notes textarea keeps the old note",
    async () => {
      const app = await mountTx({ transactions: [projectedManual({ notes: "remember milk" })] });
      await editManual(app, "m1", { notes: "" });
      expect(storedTxs(app)[0].notes ?? "").toBe("");
    },
    T
  );
});

describe("amount validation in the Complete modal", () => {
  it(
    "UI-LIFE-09 — the Complete modal accepts a NEGATIVE actual amount (the manual form rejects <= 0), crediting the balance for an expense",
    async () => {
      // observed: completing a 100 expense with -50 succeeds and the balance goes UP to 10,050.
      const app = await mountTx({ transactions: [projectedManual()] });
      const before = balanceOf(app);
      const dlg = await openTx(app, "m1");
      await app.user.clear(within(dlg).getByLabelText(/Actual Amount/));
      await app.user.type(within(dlg).getByLabelText(/Actual Amount/), "-50");
      await app.user.click(within(dlg).getByRole("button", { name: "Mark Complete" }));
      await app.settle();
      expect(storedTxs(app)[0].status).toBe("projected");
      expect(balanceOf(app)).toBe(before);
    },
    T
  );

  it("an empty actual amount is refused with 'Amount is required' and writes nothing", async () => {
    const app = await mountTx({ transactions: [projectedManual()] });
    const dlg = await openTx(app, "m1");
    await app.user.clear(within(dlg).getByLabelText(/Actual Amount/));
    await app.user.click(within(dlg).getByRole("button", { name: "Mark Complete" }));
    expect(await within(dlg).findByText("Amount is required")).toBeInTheDocument();
    expect(storedTxs(app)[0].status).toBe("projected");
    expect(balanceOf(app)).toBe(10_000);
  }, T);

  it.todo("DECISION: may a bill be completed with an actual amount of 0 (waived / refunded)?");
  it.todo("DECISION: may a completion be dated in the future (a completed row that has not happened yet)?");
});

describe("rule occurrence completion is not affected by manual rows with the same name", () => {
  it("a manual row named like a rule is independent of the rule occurrence", async () => {
    const app = await mountTx({
      expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", startDate: "2026-01-12", endDate: "2026-01-12" })],
      transactions: [projectedManual({ id: "mr", name: "Rent", scheduledDate: "2026-01-12" })],
    });
    expect(app.financial().transactions).toHaveLength(2);
    await completeTx(app, "mr", { amount: 90 });
    expect(balanceOf(app)).toBe(9_910);
    const rule = app.financial().transactions.find((t) => t.sourceId === "rent")!;
    expect(rule.status).toBe("projected");
    expectInvariants(app, ["complete manual"]);
  }, T);
});
