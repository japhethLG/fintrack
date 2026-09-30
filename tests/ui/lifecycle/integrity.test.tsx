import { describe, expect, it } from "vitest";
import { screen, knownDefect, makeCompletedTransaction, makeExpenseRule } from "../harness";
import {
  balanceOf,
  completeTx,
  displayedBalance,
  merged,
  mountTx,
  openTx,
  rowFor,
  storedTxs,
} from "./kit";
import { within, waitFor } from "../harness";

/**
 * Merge integrity and time-zone display: stored rows vs. generated projections, and dates as the
 * Transactions list prints them.
 */
const T = 90_000;

/** Rent due on the 1st, moved to the Friday before when it falls on a weekend.
 *  Jan 1 2026 = Thu -> Jan 1; Feb 1 2026 = Sun -> Fri Jan 30; Mar 1 = Sun -> Fri Feb 27. */
const rent1st = () =>
  makeExpenseRule({
    id: "r",
    name: "Rent1st",
    amount: 1_000,
    startDate: "2026-01-01",
    endDate: "2026-04-30",
    weekendAdjustment: "before",
  });
const rows = (app: Awaited<ReturnType<typeof mountTx>>) => merged(app).filter((t) => t.sourceId === "r");

describe("two occurrences in one calendar month (weekend adjustment crosses a month boundary)", () => {
  it("precondition: the rule projects Jan 1, Jan 30, Feb 27, Apr 1", async () => {
    const app = await mountTx({ expenseRules: [rent1st()] });
    expect(rows(app).map((t) => t.scheduledDate)).toEqual(["2026-01-01", "2026-01-30", "2026-02-27", "2026-04-01"]);
  }, T);

  knownDefect(
    "UI-LIFE-27",
    "Jan 1 and the Feb-1-adjusted Jan 30 payment get the SAME occurrenceId (r_2026-01)",
    async () => {
      // observed: ids [r_2026-01, r_2026-01, r_2026-02, r_2026-04]
      const app = await mountTx({ expenseRules: [rent1st()] });
      expect(rows(app)).toHaveLength(4);
      const ids = rows(app).map((t) => t.occurrenceId);
      expect(new Set(ids).size).toBe(4);
    },
    T
  );

  knownDefect(
    "UI-LIFE-28",
    "paying both January-dated bills makes the first payment vanish from the list and shows Jan 30 twice",
    async () => {
      // observed after paying Jan 1 then Jan 30: stored 2 completed docs, merged shows 1 completed
      // (Jan 30) + 1 projected Jan 30; the Jan 1 payment is gone; Settings warns 'Balance mismatch'.
      const app = await mountTx({ expenseRules: [rent1st()] });
      await completeTx(app, rows(app)[0].id);
      await completeTx(app, rows(app).find((t) => t.scheduledDate === "2026-01-30")!.id);
      expect(storedTxs(app)).toHaveLength(2);
      expect(balanceOf(app)).toBe(8_000); // precondition: both payments debited
      const m = merged(app).filter((t) => t.sourceId === "r");
      expect(m.filter((t) => t.status === "completed")).toHaveLength(2);
      expect(m).toHaveLength(4);
    },
    T
  );

  knownDefect(
    "UI-LIFE-29",
    "after that, the app's 'Recalculate Balance' button would corrupt the correct balance (8,000 -> 9,000)",
    async () => {
      const app = await mountTx({ expenseRules: [rent1st()] });
      await completeTx(app, rows(app)[0].id);
      await completeTx(app, rows(app).find((t) => t.scheduledDate === "2026-01-30")!.id);
      expect(balanceOf(app)).toBe(8_000);
      const btn = screen.queryByRole("button", { name: /Recalculate Balance/ });
      if (btn) {
        await app.user.click(btn);
        await app.settle();
      }
      expect(balanceOf(app)).toBe(8_000);
      expect(displayedBalance()).toBe(8_000);
    },
    T
  );
});

describe("legacy stored rows", () => {
  knownDefect(
    "UI-LIFE-30",
    "a completed rule row stored WITHOUT occurrenceId is shown twice (completed + a fresh projection for the same day)",
    async () => {
      // observed: 2 rows named Rent on 2026-01-12. mergeTransactionsWithProjections falls back to
      // `${sourceId}-${scheduledDate}` but projections always key on occurrenceId.
      const app = await mountTx({
        profile: { currentBalance: 8_800 },
        expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", startDate: "2026-01-12", endDate: "2026-01-12" })],
        transactions: [
          makeCompletedTransaction({ id: "old", sourceType: "expense_rule", sourceId: "rent", name: "Rent", type: "expense", projectedAmount: 1_200, scheduledDate: "2026-01-12" }),
        ],
      });
      expect(storedTxs(app)).toHaveLength(1);
      expect(merged(app).filter((t) => t.name === "Rent")).toHaveLength(1);
    },
    T
  );
});

describe("dates as the Transactions list prints them (America/New_York, UTC-5)", () => {
  knownDefect(
    "UI-LIFE-31",
    "the list row shows the day BEFORE (1/9/2026) for a bill scheduled 2026-01-10, while the modal says Jan 10",
    async () => {
      // observed: row date = new Date('2026-01-10').toLocaleDateString() -> UTC midnight -> 1/9/2026 in New York
      const app = await mountTx(
        { expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", startDate: "2026-01-10", endDate: "2026-01-10" })] },
        { timeZone: "America/New_York" }
      );
      expect(new Date().getTimezoneOffset()).toBe(300);
      const tx = merged(app).find((t) => t.name === "Rent")!;
      const dlg = await openTx(app, tx.id);
      expect(within(dlg).getByText(/Sat, Jan 10, 2026/)).toBeInTheDocument(); // precondition: the modal is right
      await app.user.click(within(dlg).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(rowFor(app, tx.id).textContent).toContain("1/10/2026");
    },
    T
  );

  const overdueStat = () => screen.getByText("Overdue").nextElementSibling!.textContent;

  knownDefect(
    "UI-LIFE-32",
    "a bill due TODAY (Jan 15, 22:30 New York) is counted as Overdue by the summary card",
    async () => {
      // observed: 1 (the card compares against today's UTC date, Jan 16).
      const app = await mountTx(
        { expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", startDate: "2026-01-15", endDate: "2026-01-15" })] },
        { timeZone: "America/New_York", today: "2026-01-15T22:30" }
      );
      expect(new Date().getDate()).toBe(15);
      expect(merged(app).filter((t) => t.scheduledDate === "2026-01-15")).toHaveLength(1);
      expect(overdueStat()).toBe("0");
    },
    T
  );

  it("summary cards count Total/Pending/Overdue from the merged list (UTC noon, bill due Jan 12)", async () => {
    const app = await mountTx({
      expenseRules: [makeExpenseRule({ id: "rent", name: "Rent", startDate: "2026-01-12", endDate: "2026-01-12" })],
    });
    expect(screen.getByText("Total").nextElementSibling!.textContent).toBe("1");
    expect(screen.getByText("Pending").nextElementSibling!.textContent).toBe("1");
    expect(overdueStat()).toBe("1");
    await completeTx(app, merged(app)[0].id);
    expect(screen.getByText("Completed").nextElementSibling!.textContent).toBe("1");
    expect(overdueStat()).toBe("0");
  }, T);
});

describe("decisions not made yet", () => {
  it.todo("DECISION: does an overdue, still-projected bill reduce the balance the Calendar shows for today?");
  it.todo("DECISION: is a variance attributed to the scheduled month or the month it was actually paid?");
  it.todo("DECISION: does the overdue modal's 'Total Overdue' add missed income to missed bills?");
});
