import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  act,
  renderApp,
  screen,
  within,
  knownDefect,
  makeExpenseRule,
  makeIncomeSource,
  makeManualTransaction,
  makeCompletedTransaction,
} from "../harness";
import {
  Screens,
  addManualViaForm,
  calendarToday,
  clickRecalculate,
  dashboardCurrent,
  completeViaModal,
  deleteManualViaModal,
  editManualViaForm,
  expectBalanceInvariant,
  findTxn,
  mismatchBanner,
  revertViaModal,
  screenEl,
  settingsComputed,
  settingsComputedCount,
  settingsCurrent,
  skipViaModal,
  storedBalance,
} from "./support";

/**
 * CORE INVARIANT, driven through real gestures:
 *
 *   displayed current balance == initialBalance + Σ signed(completed transactions)
 *
 * and every screen that prints a balance agrees. Every expected number below
 * is worked out by hand in a comment; nothing calls an app function.
 */

const TODAY = "2026-01-15"; // a Thursday

const monthlyPlan = {
  incomeSources: [
    makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, startDate: "2026-01-02" }),
  ],
  expenseRules: [
    makeExpenseRule({ id: "rent", name: "Rent", amount: 1_200, startDate: "2026-01-10" }),
  ],
};

describe("invariant: rule-based gestures through TransactionModal", () => {
  it(
    "complete and re-complete keep every screen in agreement",
    async () => {
      const app = await renderApp({
        ui: <Screens />,
        today: TODAY,
        seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 }, ...monthlyPlan },
      });
      // Preconditions: both January occurrences are projected and overdue.
      expect(findTxn(app, (t) => t.name === "Salary" && t.scheduledDate === "2026-01-02").status).toBe("projected");
      expect(findTxn(app, (t) => t.name === "Rent" && t.scheduledDate === "2026-01-10").status).toBe("projected");

      // 0. nothing completed: 10,000. (Calendar is skipped: two overdue projected rows
      //    legitimately drag its running balance below the actual balance.)
      await expectBalanceInvariant(app, { balance: 10_000, completedCount: 0 }, "start");

      // 1. Salary completed at 3,100 (variance +100): 10,000 + 3,100 = 13,100
      await completeViaModal(app, findTxn(app, (t) => t.name === "Salary" && t.scheduledDate === "2026-01-02"), { amount: 3_100 });
      await expectBalanceInvariant(app, { balance: 13_100, completedCount: 1 }, "salary completed");

      // 2. Rent completed at 1,150: 13,100 - 1,150 = 11,950. Nothing overdue now, so the
      //    calendar's closing balance for today must equal it too.
      await completeViaModal(app, findTxn(app, (t) => t.name === "Rent" && t.scheduledDate === "2026-01-10"), { amount: 1_150 });
      await expectBalanceInvariant(app, { balance: 11_950, completedCount: 2, calendar: true }, "rent completed");

      // 3. Re-complete Rent at 1,100 (the modal's "Resubmitting will update the amount"):
      //    10,000 + 3,100 - 1,100 = 12,000
      await completeViaModal(app, findTxn(app, (t) => t.name === "Rent" && t.status === "completed"), { amount: 1_100 });
      await expectBalanceInvariant(app, { balance: 12_000, completedCount: 2, calendar: true }, "rent re-completed");
    },
    150_000
  );

  it(
    "skip, complete-from-skipped and revert (from two completed rows) keep every screen in agreement",
    async () => {
      // Start = the end of the previous test: Salary completed 3,100, Rent completed 1,100 => 10,000 + 3,100 - 1,100 = 12,000.
      const app = await renderApp({
        ui: <Screens />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 12_000, initialBalance: 10_000 },
          ...monthlyPlan,
          transactions: [
            makeCompletedTransaction({ id: "s1", sourceType: "income_source", sourceId: "sal", name: "Salary", type: "income", category: "salary", projectedAmount: 3_000, actualAmount: 3_100, scheduledDate: "2026-01-02", occurrenceId: "sal_2026-01" }),
            makeCompletedTransaction({ id: "r1", sourceType: "expense_rule", sourceId: "rent", name: "Rent", type: "expense", category: "housing", projectedAmount: 1_200, actualAmount: 1_100, scheduledDate: "2026-01-10", occurrenceId: "rent_2026-01" }),
          ],
        },
      });
      await expectBalanceInvariant(app, { balance: 12_000, completedCount: 2, calendar: true }, "start");

      // 4. Skip the completed Salary: its 3,100 no longer counts. 10,000 - 1,100 = 8,900
      await skipViaModal(app, findTxn(app, (t) => t.name === "Salary" && t.status === "completed"));
      await expectBalanceInvariant(app, { balance: 8_900, completedCount: 1, calendar: true }, "salary skipped");

      // 5. Complete the skipped Salary at 2,900: 8,900 + 2,900 = 11,800
      await completeViaModal(app, findTxn(app, (t) => t.name === "Salary" && t.status === "skipped"), { amount: 2_900 });
      await expectBalanceInvariant(app, { balance: 11_800, completedCount: 2, calendar: true }, "salary re-completed");

      // 6. Revert Rent to projected: its 1,100 comes back. 10,000 + 2,900 = 12,900
      //    (Rent is a projected, overdue bill again, so skip the calendar.)
      await revertViaModal(app, findTxn(app, (t) => t.name === "Rent" && t.status === "completed"));
      await expectBalanceInvariant(app, { balance: 12_900, completedCount: 1 }, "rent reverted");
    },
    150_000
  );

  it("completing an income and a bill on the same day nets to the hand-computed balance in the calendar's day panel", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "calendar"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 500, initialBalance: 500 },
        incomeSources: [makeIncomeSource({ id: "s", name: "Gig", amount: 200, startDate: "2026-01-15" })],
        expenseRules: [makeExpenseRule({ id: "b", name: "Phone", amount: 50, startDate: "2026-01-15" })],
      },
    });
    await completeViaModal(app, findTxn(app, (t) => t.name === "Gig"));
    await completeViaModal(app, findTxn(app, (t) => t.name === "Phone"));
    // 500 + 200 - 50 = 650 ; both dated today, so today's OPENING is 500 and CLOSING 650.
    await expectBalanceInvariant(app, { balance: 650, completedCount: 2 }, "same-day pair");
    const today = await calendarToday(app);
    expect(today.opening).toBe(500);
    expect(today.closing).toBe(650);
  }, 60_000);
});

describe("invariant: manual transactions (Add Manual Transaction form)", () => {
  knownDefect(
    "UI-BAL-01",
    "adding a COMPLETED manual expense never moves the balance (MUT-4)",
    async () => {
      // observed: stored/displayed 10,000 after a completed 400 expense; Settings computes 9,600
      // and shows "Balance mismatch detected: $400".
      const app = await renderApp({
        ui: <Screens only={["settings", "dashboard"]} />,
        today: TODAY,
        seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
      });
      await addManualViaForm(app, { name: "Groceries", type: "expense", amount: 400, date: "2026-01-14", status: "completed" });
      // preconditions: the row really was stored as completed, and the screens re-rendered
      const stored = app.store.__all<{ status: string; actualAmount: number }>("transactions");
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ status: "completed", actualAmount: 400 });
      expect(settingsComputedCount(screenEl("settings"))).toBe(1);
      // the ledger says 10,000 - 400
      expect(settingsComputed(screenEl("settings"))).toBe(9_600);
      // money assertion: the displayed balance follows the ledger
      expect(settingsCurrent(screenEl("settings"))).toBe(9_600);
    },
    60_000
  );

  knownDefect(
    "UI-BAL-02",
    "add-then-delete of a completed manual expense leaves the balance 2x the amount too high",
    async () => {
      // observed: 10,400 (add applies nothing, delete adds 400 back). correct: 10,000.
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
      });
      await addManualViaForm(app, { name: "Groceries", type: "expense", amount: 400, date: "2026-01-14", status: "completed" });
      await deleteManualViaModal(app, findTxn(app, (t) => t.name === "Groceries"));
      // preconditions: the row is gone, so nothing is completed and initial + 0 = 10,000
      expect(app.store.__count("transactions")).toBe(0);
      expect(settingsComputed(screenEl("settings"))).toBe(10_000);
      expect(settingsCurrent(screenEl("settings"))).toBe(10_000);
    },
    60_000
  );

  it("deleting a completed manual expense that WAS applied gives the money back", async () => {
    // initial 10,000, one completed 400 expense already applied: current 9,600.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 9_600, initialBalance: 10_000 },
        transactions: [makeManualTransaction({ id: "m1", name: "Groceries", status: "completed", projectedAmount: 400, actualAmount: 400, scheduledDate: "2026-01-14", actualDate: "2026-01-14" })],
      },
    });
    await expectBalanceInvariant(app, { balance: 9_600, completedCount: 1 }, "before delete");
    await deleteManualViaModal(app, findTxn(app, (t) => t.id === "m1"));
    expect(app.store.__count("transactions")).toBe(0);
    // 10,000 + nothing
    await expectBalanceInvariant(app, { balance: 10_000, completedCount: 0 }, "after delete");
  }, 60_000);

  it("raising the amount of a completed manual income applies only the difference", async () => {
    // initial 10,000 + completed income 100 = current 10,100. Edit to 120: 10,000 + 120 = 10,120.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 10_100, initialBalance: 10_000 },
        transactions: [makeManualTransaction({ id: "m1", name: "Tip", type: "income", status: "completed", projectedAmount: 100, actualAmount: 100, scheduledDate: "2026-01-14", actualDate: "2026-01-14" })],
      },
    });
    await editManualViaForm(app, findTxn(app, (t) => t.id === "m1"), { amount: 120 });
    expect(app.store.__get<{ actualAmount: number }>("transactions", "m1")?.actualAmount).toBe(120);
    await expectBalanceInvariant(app, { balance: 10_120, completedCount: 1 }, "amount edited");
  }, 60_000);

  knownDefect(
    "UI-BAL-03",
    "flipping a completed manual INCOME to an EXPENSE (same amount) does not move the balance (MUT-5)",
    async () => {
      // observed: current stays 10,100 (no branch fires, amounts are equal); ledger says 10,000 - 100 = 9,900,
      // Settings shows "Balance mismatch detected: $200".
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 10_100, initialBalance: 10_000 },
          transactions: [makeManualTransaction({ id: "m1", name: "Tip", type: "income", status: "completed", projectedAmount: 100, actualAmount: 100, scheduledDate: "2026-01-14", actualDate: "2026-01-14" })],
        },
      });
      await editManualViaForm(app, findTxn(app, (t) => t.id === "m1"), { type: "expense" });
      // preconditions: the edit was saved as an expense and is still the only completed row
      expect(app.store.__get<{ type: string }>("transactions", "m1")?.type).toBe("expense");
      expect(settingsComputedCount(screenEl("settings"))).toBe(1);
      expect(settingsComputed(screenEl("settings"))).toBe(9_900);
      expect(settingsCurrent(screenEl("settings"))).toBe(9_900);
    },
    60_000
  );

  knownDefect(
    "UI-BAL-04",
    "flipping a completed manual income (100) to an expense of 120 moves the balance the WRONG way (+20 instead of -220)",
    async () => {
      // observed: 10,120 (delta computed from the OLD type: 120 - 100 = +20). correct: 10,000 - 120 = 9,880.
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: {
          profile: { currentBalance: 10_100, initialBalance: 10_000 },
          transactions: [makeManualTransaction({ id: "m1", name: "Tip", type: "income", status: "completed", projectedAmount: 100, actualAmount: 100, scheduledDate: "2026-01-14", actualDate: "2026-01-14" })],
        },
      });
      await editManualViaForm(app, findTxn(app, (t) => t.id === "m1"), { type: "expense", amount: 120 });
      const saved = app.store.__get<{ type: string; actualAmount: number }>("transactions", "m1");
      expect(saved).toMatchObject({ type: "expense", actualAmount: 120 });
      expect(settingsComputed(screenEl("settings"))).toBe(9_880);
      expect(settingsCurrent(screenEl("settings"))).toBe(9_880);
    },
    60_000
  );
});

describe("invariant: the Settings balance controls", () => {
  it("Update Initial Balance with completed history recomputes current = new initial + history, after an explicit confirmation", async () => {
    // initial 10,000; completed: +3,000 income, -1,150 expense => current 11,850.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 11_850, initialBalance: 10_000 },
        transactions: [
          makeCompletedTransaction({ id: "i", type: "income", projectedAmount: 3_000, scheduledDate: "2026-01-02" }),
          makeCompletedTransaction({ id: "e", type: "expense", projectedAmount: 1_200, actualAmount: 1_150, scheduledDate: "2026-01-10" }),
        ],
      },
    });
    const settings = within(screenEl("settings"));
    await expectBalanceInvariant(app, { balance: 11_850, completedCount: 2 }, "before");

    await app.user.click(settings.getByRole("button", { name: /Update Initial Balance/ }));
    await app.user.type(settings.getByLabelText("Set Initial Balance"), "12000");
    await app.user.click(settings.getByRole("button", { name: "Update Initial Balance" }));

    // Confirmation panel: nothing written yet.
    expect(await settings.findByText("Confirm Initial Balance Update")).toBeInTheDocument();
    expect(app.store.__get<{ initialBalance: number }>("users", app.uid)?.initialBalance).toBe(10_000);
    // new initial 12,000 + 3,000 - 1,150 = 13,850
    expect(settings.getByText(/You have 2 completed transactions/)).toBeInTheDocument();
    const panel = settings.getByText("Confirm Initial Balance Update").closest("div.space-y-3") as HTMLElement;
    expect(within(panel).getByText("New initial balance:").parentElement!.textContent).toMatch(/12,000\.00/);
    expect(within(panel).getByText("New computed balance:").parentElement!.textContent).toMatch(/13,850\.00/);

    await app.user.click(settings.getByRole("button", { name: "Update & Recalculate" }));
    await settings.findByText("Balance updated successfully!");
    await app.settle();
    expect(app.store.__get<{ initialBalance: number }>("users", app.uid)?.initialBalance).toBe(12_000);
    await expectBalanceInvariant(app, { balance: 13_850, completedCount: 2 }, "after confirm");
  }, 60_000);

  it("cancelling the initial-balance confirmation writes nothing", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 9_000, initialBalance: 10_000 },
        transactions: [makeCompletedTransaction({ id: "e", type: "expense", projectedAmount: 1_000, scheduledDate: "2026-01-10" })],
      },
    });
    const settings = within(screenEl("settings"));
    const writesBefore = app.store.__ops.length;
    await app.user.click(settings.getByRole("button", { name: /Update Initial Balance/ }));
    await app.user.type(settings.getByLabelText("Set Initial Balance"), "50000");
    await app.user.click(settings.getByRole("button", { name: "Update Initial Balance" }));
    await settings.findByText("Confirm Initial Balance Update");
    await app.user.click(settings.getByRole("button", { name: "Cancel" }));
    expect(settings.queryByText("Confirm Initial Balance Update")).not.toBeInTheDocument();
    expect(app.store.__ops.length).toBe(writesBefore);
    await expectBalanceInvariant(app, { balance: 9_000, completedCount: 1 }, "after cancel");
    // 10,000 baseline is still what the panel shows
    expect(within(screenEl("settings")).getByText("Starting Balance (Baseline)").parentElement!.textContent).toMatch(/10,000\.00/);
  }, 60_000);

  it("Update Initial Balance with NO completed history writes immediately and current follows it", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
    });
    const settings = within(screenEl("settings"));
    await app.user.click(settings.getByRole("button", { name: /Update Initial Balance/ }));
    await app.user.type(settings.getByLabelText("Set Initial Balance"), "2500.75");
    await app.user.click(settings.getByRole("button", { name: "Update Initial Balance" }));
    await settings.findByText("Balance updated successfully!");
    await app.settle();
    expect(settings.queryByText("Confirm Initial Balance Update")).not.toBeInTheDocument();
    // no history: current == initial == 2,500.75
    await expectBalanceInvariant(app, { balance: 2_500.75, completedCount: 0 }, "no history");
  }, 60_000);

  it("Update Initial Balance rejects an empty value and stores 0 when 0 is typed", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 700, initialBalance: 700 } },
    });
    const settings = within(screenEl("settings"));
    await app.user.click(settings.getByRole("button", { name: /Update Initial Balance/ }));
    await app.user.click(settings.getByRole("button", { name: "Update Initial Balance" }));
    expect(await settings.findByText("Initial balance is required")).toBeInTheDocument();
    expect(app.store.__get<{ initialBalance: number }>("users", app.uid)?.initialBalance).toBe(700);

    await app.user.type(settings.getByLabelText("Set Initial Balance"), "0");
    await app.user.click(settings.getByRole("button", { name: "Update Initial Balance" }));
    await settings.findByText("Balance updated successfully!");
    await app.settle();
    // a legitimate zero baseline is stored as 0 (not dropped, not defaulted) and current follows
    expect(app.store.__get<{ initialBalance: number }>("users", app.uid)?.initialBalance).toBe(0);
    expect(storedBalance(app)).toBe(0);
  }, 60_000);

  it("Override Current Balance stores exactly what was typed, closes the form, and leaves the ledger untouched", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
    });
    const settings = within(screenEl("settings"));
    await app.user.click(settings.getByRole("button", { name: /Override Current Balance/ }));
    expect(settings.getByText(/This will override the computed balance/)).toBeInTheDocument();
    await app.user.type(settings.getByLabelText("Override Current Balance"), "12345.67");
    await app.user.click(settings.getByRole("button", { name: "Override Balance" }));
    await settings.findByText("Balance updated successfully!");
    await app.settle();
    const doc = app.store.__get<{ currentBalance: number; initialBalance: number }>("users", app.uid)!;
    expect(doc.currentBalance).toBe(12_345.67);
    expect(doc.initialBalance).toBe(10_000);
    expect(settingsCurrent(screenEl("settings"))).toBe(12_345.67);
    expect(dashboardCurrent()).toBe(12_345.67);
    expect(settings.queryByLabelText("Override Current Balance")).not.toBeInTheDocument();
  }, 60_000);

  it("Override Current Balance rejects an empty value and accepts a negative one (shown as a negative balance)", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 100, initialBalance: 100 } },
    });
    const settings = within(screenEl("settings"));
    await app.user.click(settings.getByRole("button", { name: /Override Current Balance/ }));
    await app.user.click(settings.getByRole("button", { name: "Override Balance" }));
    expect(await settings.findByText("Balance is required")).toBeInTheDocument();
    expect(storedBalance(app)).toBe(100);

    await app.user.type(settings.getByLabelText("Override Current Balance"), "-250.5");
    await app.user.click(settings.getByRole("button", { name: "Override Balance" }));
    await settings.findByText("Balance updated successfully!");
    await app.settle();
    expect(storedBalance(app)).toBe(-250.5);
    expect(dashboardCurrent()).toBe(-250.5);
    expect(within(screenEl("dashboard")).getByText("Negative balance!")).toBeInTheDocument();
  }, 60_000);

  knownDefect(
    "UI-BAL-05",
    "Override Current Balance immediately trips the app's own 'Balance mismatch' banner (MUT-12)",
    async () => {
      // observed: after overriding to 12,345.67 the banner quotes "$2,345.67" and offers a button that
      // silently undoes the correction. The user's stated invariant (current == initial + Σ completed)
      // is broken by a shipped, supported gesture.
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
      });
      const settings = within(screenEl("settings"));
      await app.user.click(settings.getByRole("button", { name: /Override Current Balance/ }));
      await app.user.type(settings.getByLabelText("Override Current Balance"), "12345.67");
      await app.user.click(settings.getByRole("button", { name: "Override Balance" }));
      await settings.findByText("Balance updated successfully!");
      await app.settle();
      // preconditions: the override landed and no transaction exists to explain a difference
      expect(storedBalance(app)).toBe(12_345.67);
      expect(settingsCurrent(screenEl("settings"))).toBe(12_345.67);
      expect(app.store.__count("transactions")).toBe(0);
      // money assertion: whatever mechanism reconciles it, the two figures agree afterwards
      expect(settingsComputed(screenEl("settings"))).toBe(12_345.67);
      expect(mismatchBanner(screenEl("settings"))).toBeNull();
    },
    60_000
  );

  it("Recalculate Balance replaces an override with initial + history, without any confirmation", async () => {
    // documents current behaviour: override 12,345.67 -> recalc -> 10,000 (one click, no warning)
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 12_345.67, initialBalance: 10_000 } },
    });
    expect(mismatchBanner(screenEl("settings"))).toBeCloseTo(2_345.67, 2);
    await clickRecalculate(app);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await expectBalanceInvariant(app, { balance: 10_000, completedCount: 0 }, "after recalc");
  }, 60_000);

  it.todo(
    "DECISION: should an override adjust initialBalance (baseline shifts), record an 'adjustment' ledger entry, or stay a bare stored number that Recalculate can discard?"
  );

  it("the mismatch banner appears only for differences above one cent and quotes the absolute difference", async () => {
    // current 10,000.005 vs computed 10,000: half a cent -> no banner
    const a = await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 10_000.005, initialBalance: 10_000 } },
    });
    expect(mismatchBanner()).toBeNull();
    a.unmount();
    // current 9,999.5 vs computed 10,000: 0.50 lower -> banner quotes 0.50 (absolute)
    await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 9_999.5, initialBalance: 10_000 } },
    });
    expect(mismatchBanner()).toBeCloseTo(0.5, 2);
  });
});

// ---------------------------------------------------------------------------
// The semi-monthly [15,30] "after" collision (docs: Path A)
// ---------------------------------------------------------------------------

describe("invariant: two paychecks that share an occurrenceId", () => {
  const paySeed = {
    profile: { currentBalance: 10_000, initialBalance: 10_000 },
    incomeSources: [
      makeIncomeSource({
        id: "inc-1",
        name: "Pay",
        amount: 30_000,
        frequency: "semi-monthly",
        startDate: "2026-01-15",
        scheduleConfig: { specificDays: [15, 30] },
        weekendAdjustment: "after",
      }),
    ],
  };

  const completeThreeMarchPaychecks = async (app: Awaited<ReturnType<typeof renderApp>>) => {
    const march = () =>
      app.financial().transactions.filter((t) => t.scheduledDate.startsWith("2026-03"));
    // Preconditions: this seed produces three March rows, and the last two carry ONE occurrenceId
    expect(march().map((t) => t.scheduledDate)).toEqual(["2026-03-02", "2026-03-16", "2026-03-30"]);
    expect(march()[1].occurrenceId).toBeTruthy();
    expect(march()[1].occurrenceId).toBe(march()[2].occurrenceId);
    await completeViaModal(app, march()[0], { amount: 28_000 });
    await completeViaModal(app, findTxn(app, (t) => t.scheduledDate === "2026-03-16"), { amount: 25_000 });
    await completeViaModal(app, findTxn(app, (t) => t.scheduledDate === "2026-03-30"), { amount: 30_000 });
    // ledger truth, stored: 10,000 + 28,000 + 25,000 + 30,000
    expect(app.store.__all("transactions")).toHaveLength(3);
    expect(storedBalance(app)).toBe(93_000);
  };

  knownDefect(
    "UI-BAL-06",
    "Settings' derived balance drops one of two completed paychecks that share an occurrenceId",
    async () => {
      // observed: "Computed from 2 transactions" $68,000 and a mismatch banner quoting $25,000,
      // although all three paychecks are stored as completed and the balance is 93,000.
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-04-05", seed: paySeed });
      await completeThreeMarchPaychecks(app);
      expect(settingsCurrent(screenEl("settings"))).toBe(93_000);
      expect(settingsComputed(screenEl("settings"))).toBe(93_000);
      expect(mismatchBanner(screenEl("settings"))).toBeNull();
    },
    120_000
  );

  knownDefect(
    "UI-BAL-07",
    "clicking Recalculate Balance after the collision permanently writes a balance 25,000 too low",
    async () => {
      // observed: users.currentBalance 93,000 -> 68,000 on one click. correct: unchanged.
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-04-05", seed: paySeed });
      await completeThreeMarchPaychecks(app);
      const settings = within(screenEl("settings"));
      // With the defect fixed the banner (and its button) never appears: nothing to click, test passes.
      if (!settings.queryByRole("button", { name: /Recalculate Balance/ })) return;
      await clickRecalculate(app);
      expect(storedBalance(app)).toBe(93_000);
    },
    120_000
  );

  knownDefect(
    "UI-BAL-08",
    "after completing all three paychecks the merged list shows a completed row FEWER and a phantom projected duplicate",
    async () => {
      // observed March rows: [03-02 completed, 03-30 completed, 03-30 projected]; the completed 03-16 row is gone.
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-04-05", seed: paySeed });
      await completeThreeMarchPaychecks(app);
      const march = app.financial().transactions.filter((t) => t.scheduledDate.startsWith("2026-03"));
      expect(march).toHaveLength(3);
      expect(march.map((t) => `${t.scheduledDate}:${t.status}`)).toEqual([
        "2026-03-02:completed",
        "2026-03-16:completed",
        "2026-03-30:completed",
      ]);
    },
    120_000
  );
});


// ---------------------------------------------------------------------------
// Other ways balances move: deleting a source, another device, two devices at once
// ---------------------------------------------------------------------------

describe("invariant: sources, devices and concurrency", () => {
  it("deleting an income source that has completed history keeps the history, the balance and the reconciliation", async () => {
    const { IncomeManager } = await import("@/components/pages/income");
    const app = await renderApp({
      ui: (
        <>
          <Screens only={["settings"]} />
          <section data-screen="income">
            <IncomeManager />
          </section>
        </>
      ),
      today: TODAY,
      seed: {
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        incomeSources: [makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, startDate: "2026-01-02" })],
      },
    });
    await completeViaModal(app, findTxn(app, (t) => t.name === "Salary"), { amount: 3_000 });
    // 10,000 + 3,000
    await expectBalanceInvariant(app, { balance: 13_000, completedCount: 1 }, "before delete");

    const income = within(document.querySelector<HTMLElement>('[data-screen="income"]')!);
    await app.user.click(income.getAllByText("Salary")[0]);
    await app.user.click(await income.findByRole("button", { name: /Delete/ }));
    await app.user.click(await income.findByRole("button", { name: /Yes, Delete/ }));
    await app.settle();
    expect(app.store.__count("income_sources")).toBe(0);
    // the money already earned does not vanish with the rule that produced it
    expect(app.store.__count("transactions")).toBe(1);
    await expectBalanceInvariant(app, { balance: 13_000, completedCount: 1 }, "after delete");
  }, 60_000);

  it("a balance changed from another device shows up on every screen immediately", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: TODAY,
      seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 } },
    });
    const { updateDoc, doc } = await import("firebase/firestore");
    await act(async () => {
      // raw SDK write, as another tab / device would perform it
      await updateDoc(doc(null as never, "users", app.uid), { currentBalance: 4_242.42 });
    });
    await app.settle();
    expect(settingsCurrent(screenEl("settings"))).toBe(4_242.42);
    expect(dashboardCurrent()).toBe(4_242.42);
    const { forecastCurrent } = await import("./support");
    expect(forecastCurrent()).toBeCloseTo(4_242.42, 2);
  }, 40_000);

  knownDefect(
    "UI-BAL-42",
    "two completions in flight at once (two tabs/devices) lose one of the two balance updates (read-modify-write, no increment)",
    async () => {
      // observed: users.currentBalance 8,800 - the +3,000 salary was overwritten by the rent's -1,200 based on a stale read.
      // correct: 10,000 + 3,000 - 1,200 = 11,800. (Driven through the context action the modal calls; one tab's single
      // modal cannot overlap itself, two tabs produce exactly this interleaving.)
      const app = await renderApp({
        ui: <Screens only={["settings"]} />,
        today: TODAY,
        seed: { profile: { currentBalance: 10_000, initialBalance: 10_000 }, ...monthlyPlan },
      });
      const salary = findTxn(app, (t) => t.name === "Salary" && t.scheduledDate === "2026-01-02");
      const rent = findTxn(app, (t) => t.name === "Rent" && t.scheduledDate === "2026-01-10");
      await act(async () => {
        await Promise.all([
          app.financial().markTransactionComplete(salary.id, { actualAmount: 3_000, actualDate: "2026-01-02" }),
          app.financial().markTransactionComplete(rent.id, { actualAmount: 1_200, actualDate: "2026-01-10" }),
        ]);
      });
      await app.settle();
      // preconditions: both completions were stored, and the ledger says 11,800
      expect(app.store.__all<{ status: string }>("transactions").filter((t) => t.status === "completed")).toHaveLength(2);
      expect(settingsComputed(screenEl("settings"))).toBe(11_800);
      expect(storedBalance(app)).toBe(11_800);
    },
    40_000
  );
});
