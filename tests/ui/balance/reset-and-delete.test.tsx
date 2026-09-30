import { describe, expect, it } from "vitest";
import * as React from "react";
import type { Mock } from "vitest";
import {
  renderApp,
  screen,
  within,
  waitFor,
  knownDefect,
  makeAlert,
  makeBalanceSnapshot,
  makeExpenseRule,
  makeIncomeSource,
  makeManualTransaction,
  makeUserProfile,
} from "../harness";
import {
  Screens,
  expectBalanceInvariant,
  mismatchBanner,
  openSelectiveReset,
  runSelectiveReset,
  screenEl,
  settingsComputed,
  settingsComputedCount,
  settingsCurrent,
  settingsInitial,
  storedBalance,
} from "./support";
import * as store from "../../helpers/firestoreEmulator";

/**
 * Selective Reset modal, "All Financial Data", and Delete Account, through the real
 * DangerZone / SelectiveResetModal / ConfirmModal. "Full reset" in this app IS the
 * "All Financial Data" checkbox: the AuthContext's resetFinancialData() has no caller.
 */

const COLLECTIONS = ["income_sources", "expense_rules", "transactions", "balance_history", "alerts"] as const;
type Col = (typeof COLLECTIONS)[number];
const LABEL: Record<Col, string> = {
  income_sources: "Income Sources",
  expense_rules: "Expense Rules",
  transactions: "Transactions",
  balance_history: "Balance History",
  alerts: "Alerts",
};

/** user-1: what the tests reset. user-2: a bystander whose data must never move. */
const world = () => ({
  profile: { currentBalance: 9_000, initialBalance: 10_000 }, // 10,000 - one completed 1,000 expense
  incomeSources: [makeIncomeSource({ id: "i1", name: "Salary", startDate: "2026-01-20" })],
  expenseRules: [makeExpenseRule({ id: "e1", name: "Rent", startDate: "2026-01-25" })],
  transactions: [
    makeManualTransaction({ id: "t1", name: "Groceries", status: "completed", projectedAmount: 1_000, actualAmount: 1_000, scheduledDate: "2026-01-05", actualDate: "2026-01-05" }),
  ],
  alerts: [makeAlert({ id: "al1" })],
  balanceHistory: [makeBalanceSnapshot({ id: "b1" })],
});

const seedBystander = (app: { store: typeof store }) => {
  app.store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", email: "b@example.com", currentBalance: 555, initialBalance: 555 }));
  app.store.__seed("income_sources", "i2", makeIncomeSource({ id: "i2", userId: "user-2" }));
  app.store.__seed("expense_rules", "e2", makeExpenseRule({ id: "e2", userId: "user-2" }));
  app.store.__seed("transactions", "t2", makeManualTransaction({ id: "t2", userId: "user-2" }));
  app.store.__seed("alerts", "al2", makeAlert({ id: "al2", userId: "user-2" }));
  app.store.__seed("balance_history", "b2", makeBalanceSnapshot({ id: "b2", userId: "user-2" }));
};

const countsOf = (app: { store: typeof store }, uid: string) =>
  Object.fromEntries(
    COLLECTIONS.map((c) => [c, app.store.__all<{ userId: string }>(c).filter((d) => d.userId === uid).length])
  ) as Record<Col, number>;

const ONE_EACH: Record<Col, number> = { income_sources: 1, expense_rules: 1, transactions: 1, balance_history: 1, alerts: 1 };

describe("what each checkbox combination deletes", () => {
  it.each(COLLECTIONS)("ticking only '%s' deletes exactly that collection for this user and nothing else", async (col) => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    seedBystander(app);
    expect(countsOf(app, "user-1")).toEqual(ONE_EACH); // precondition
    await runSelectiveReset(app, [LABEL[col]]);
    expect(countsOf(app, "user-1")).toEqual({ ...ONE_EACH, [col]: 0 });
    // the bystander is untouched, in every collection, profile included
    expect(countsOf(app, "user-2")).toEqual(ONE_EACH);
    expect(app.store.__get<{ currentBalance: number }>("users", "user-2")?.currentBalance).toBe(555);
    // the account and its preferences survive ("Your account and preferences will be preserved")
    const doc = app.store.__get<{ displayName: string; email: string; initialBalance: number; preferences: { currency: string; defaultWarningThreshold: number } }>("users", "user-1")!;
    expect(doc).toMatchObject({ displayName: "Test User", email: "test@example.com", preferences: { currency: "USD", defaultWarningThreshold: 500 } });
    expect(doc.initialBalance).toBe(10_000);
  }, 40_000);

  it("ticking All Financial Data deletes all five collections for this user only", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    seedBystander(app);
    await runSelectiveReset(app, ["All Financial Data"]);
    expect(countsOf(app, "user-1")).toEqual({ income_sources: 0, expense_rules: 0, transactions: 0, balance_history: 0, alerts: 0 });
    expect(countsOf(app, "user-2")).toEqual(ONE_EACH);
    expect(app.store.__get("users", "user-1")).toBeDefined();
  }, 40_000);

  it("a mixed selection (rules + alerts) leaves transactions and snapshots alone", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    await runSelectiveReset(app, ["Income Sources", "Expense Rules", "Alerts"]);
    expect(countsOf(app, "user-1")).toEqual({ income_sources: 0, expense_rules: 0, transactions: 1, balance_history: 1, alerts: 0 });
  }, 40_000);

  it("deleting only rules or alerts leaves the balance, the baseline and the ledger reconciled", async () => {
    const app = await renderApp({ ui: <Screens only={["settings", "dashboard"]} />, today: "2026-01-15", seed: world() });
    await expectBalanceInvariant(app, { balance: 9_000, completedCount: 1 }, "before");
    await runSelectiveReset(app, ["Income Sources", "Expense Rules", "Alerts"]);
    // 10,000 baseline - 1,000 completed groceries, unchanged
    await expectBalanceInvariant(app, { balance: 9_000, completedCount: 1 }, "after rules+alerts reset");
  }, 40_000);
});

describe("balance after a reset", () => {
  knownDefect(
    "UI-BAL-14",
    "resetting Transactions zeroes currentBalance but keeps initialBalance, so Settings offers to resurrect the deleted money",
    async () => {
      // observed: Current $0.00 vs Starting Balance $10,000.00, banner "$10,000.00", Recalculate -> $10,000
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-01-15", seed: world() });
      await runSelectiveReset(app, ["Transactions"]);
      // preconditions: nothing is completed any more, and the reset really did run
      expect(app.store.__count("transactions")).toBe(0);
      expect(settingsComputedCount(screenEl("settings"))).toBe(0);
      // money assertion: with no history, current == initial (whichever of the two the fix changes)
      expect(settingsCurrent(screenEl("settings"))).toBe(settingsInitial(screenEl("settings")));
      expect(mismatchBanner(screenEl("settings"))).toBeNull();
    },
    40_000
  );

  knownDefect(
    "UI-BAL-15",
    "resetting only Balance History (snapshots nothing ever writes) still zeroes the balance while every transaction stays",
    async () => {
      // observed: Current $0.00 with the 1,000 expense still completed; correct 10,000 - 1,000 = 9,000
      const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-01-15", seed: world() });
      await runSelectiveReset(app, ["Balance History"]);
      expect(app.store.__count("balance_history")).toBe(0);
      expect(app.store.__count("transactions")).toBe(1); // the ledger is intact
      expect(settingsComputed(screenEl("settings"))).toBe(9_000);
      expect(settingsCurrent(screenEl("settings"))).toBe(9_000);
    },
    40_000
  );

  knownDefect(
    "UI-BAL-16",
    "'All Financial Data' leaves initialBalance at 10,000 with zero transactions, so Dashboard says 0 and Settings says the baseline is 10,000",
    async () => {
      // observed: Dashboard/Settings current $0.00, Starting Balance $10,000.00, mismatch banner $10,000.00
      const app = await renderApp({ ui: <Screens only={["settings", "dashboard"]} />, today: "2026-01-15", seed: world() });
      await runSelectiveReset(app, ["All Financial Data"]);
      expect(app.store.__count("transactions")).toBe(0);
      expect(settingsComputedCount(screenEl("settings"))).toBe(0);
      const { dashboardCurrent } = await import("./support");
      expect(dashboardCurrent()).toBe(settingsInitial(screenEl("settings")));
      expect(mismatchBanner(screenEl("settings"))).toBeNull();
    },
    40_000
  );

  it("Recalculate after a Transactions reset writes the old baseline back (documents the resurrection)", async () => {
    const app = await renderApp({ ui: <Screens only={["settings"]} />, today: "2026-01-15", seed: world() });
    await runSelectiveReset(app, ["Transactions"]);
    expect(storedBalance(app)).toBe(0);
    expect(mismatchBanner(screenEl("settings"))).toBe(10_000);
    const { clickRecalculate } = await import("./support");
    await clickRecalculate(app);
    expect(storedBalance(app)).toBe(10_000);
  }, 40_000);
});

describe("messages and copy around the reset", () => {
  it("success messages are contextual: rules -> projections changed; alerts only -> generic", async () => {
    const a = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    await runSelectiveReset(a, ["Expense Rules"]);
    expect(screen.getByText(/Your projections have changed\. Consider reviewing your balance/)).toBeInTheDocument();
    a.unmount();
    const b = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    await runSelectiveReset(b, ["Alerts"]);
    expect(screen.getByText("Selected financial data has been reset successfully.")).toBeInTheDocument();
  }, 40_000);

  knownDefect(
    "UI-BAL-17",
    "the post-reset message tells a USD user 'Your balance has been reset to ₱0'",
    async () => {
      // observed: "…Your balance has been reset to ₱0. Update your initial balance in Settings → Balance Management."
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
      await runSelectiveReset(app, ["Transactions"]);
      const msg = screen.getByText(/Selected data reset successfully\. Your balance has been reset to/);
      expect(msg.textContent).toContain("reset to");
      expect(msg.textContent).toMatch(/reset to \$0\b/);
    },
    40_000
  );

  knownDefect(
    "UI-BAL-18",
    "the Selective Reset modal promises 'balance to $0' to a PHP user",
    async () => {
      // observed: warning "…will also set your balance to $0." and "All Financial Data … (resets balance to $0)" for currency PHP
      const app = await renderApp({
        route: "/settings",
        today: "2026-01-15",
        seed: { ...world(), profile: { currentBalance: 9_000, initialBalance: 10_000, preferences: { currency: "PHP" } } },
      });
      const dialog = await openSelectiveReset(app);
      const warning = within(dialog).getByText(/Transactions and balance history resets will also set your balance to/);
      expect(warning.textContent).toContain("₱0");
      expect(within(dialog).getByText(/Everything below \(resets balance to/).textContent).toContain("₱0");
    },
    40_000
  );

  knownDefect(
    "UI-BAL-19",
    "the Danger Zone blurb says 'Balance resets to $0' for a PHP user",
    async () => {
      await renderApp({
        route: "/settings",
        seed: { profile: { currentBalance: 1, initialBalance: 1, preferences: { currency: "PHP" } } },
      });
      const blurb = screen.getByText(/Balance resets to .* when transactions or balance history are removed/);
      expect(blurb.textContent).toContain("₱0");
    }
  );

  it("counts for income sources, expense rules and alerts are the stored counts, with correct singular/plural", async () => {
    const app = await renderApp({
      route: "/settings",
      today: "2026-01-15",
      seed: {
        profile: { currentBalance: 10_000, initialBalance: 10_000 },
        incomeSources: [makeIncomeSource({ id: "i1", startDate: "2026-01-20" }), makeIncomeSource({ id: "i2", startDate: "2026-01-21", isActive: false })],
        expenseRules: [makeExpenseRule({ id: "e1", startDate: "2026-01-25" })],
        alerts: [makeAlert({ id: "a1" }), makeAlert({ id: "a2" }), makeAlert({ id: "a3", isDismissed: true })],
      },
    });
    const dialog = await openSelectiveReset(app);
    const row = (label: string) => within(dialog).getByRole("checkbox", { name: new RegExp(`^${label}`) }).closest("div")!.parentElement!.textContent ?? "";
    expect(row("Income Sources")).toMatch(/• 2 items/); // an inactive source is still deletable data
    expect(row("Expense Rules")).toMatch(/• 1 item(?!s)/);
    // 3 alert documents are stored but one is dismissed (invisible to the user); the modal counts the 2
    // live ones, while the reset below deletes all 3 documents. Characterised, not judged.
    expect(row("Alerts")).toMatch(/• 2 items/);
    await app.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await runSelectiveReset(app, ["Alerts"]);
    expect(app.store.__count("alerts")).toBe(0);
  }, 40_000);

  const countSeed = {
    profile: { currentBalance: 10_000, initialBalance: 10_000 },
    expenseRules: [makeExpenseRule({ id: "e1", startDate: "2026-01-25" })],
    transactions: [
      makeManualTransaction({ id: "t1", status: "skipped", scheduledDate: "2026-01-05" }),
      makeManualTransaction({ id: "t2", status: "projected", scheduledDate: "2026-01-06" }),
    ],
    balanceHistory: [makeBalanceSnapshot({ id: "b1" }), makeBalanceSnapshot({ id: "b2" }), makeBalanceSnapshot({ id: "b3" })],
  };

  knownDefect(
    "UI-BAL-20",
    "Transactions count in the modal includes generated projections (2 stored rows are offered as many more)",
    async () => {
      // observed: "Projected and completed items • N items" with N = 2 stored + every projected occurrence in the window
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: countSeed });
      expect(app.store.__count("transactions")).toBe(2);
      expect(app.financial().transactions.length).toBeGreaterThan(2);
      const dialog = await openSelectiveReset(app);
      const row = await within(dialog).findByText(/Projected and completed items/);
      expect(row.textContent).toMatch(/• 2 items$/);
    },
    40_000
  );

  knownDefect(
    "UI-BAL-21",
    "Balance History count is a hard-coded 0 while three snapshots are stored",
    async () => {
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: countSeed });
      expect(app.store.__count("balance_history")).toBe(3);
      const dialog = await openSelectiveReset(app);
      const row = await within(dialog).findByText(/Daily balance snapshots/);
      expect(row.textContent).toMatch(/• 3 items$/);
    },
    40_000
  );

  knownDefect(
    "UI-BAL-22",
    "the 'All Financial Data' total is not the sum of what would be deleted (stored 1 rule + 2 transactions + 3 snapshots = 6)",
    async () => {
      // observed: 1 + (2 + projections) + 0 = a larger number that counts rows nobody stored
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: countSeed });
      const stored = COLLECTIONS.reduce((n, c) => n + app.store.__count(c), 0);
      expect(stored).toBe(6);
      const dialog = await openSelectiveReset(app);
      const row = await within(dialog).findByText(/Everything below/);
      expect(row.textContent).toMatch(/• 6 items$/);
    },
    40_000
  );
});

describe("the selection and confirmation logic", () => {
  it("Continue stays disabled until something is ticked; 'All' ticks and unticks the five boxes", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const dialog = await openSelectiveReset(app);
    const cont = () => within(dialog).getByRole("button", { name: "Continue" });
    const box = (label: string) => within(dialog).getByRole("checkbox", { name: new RegExp(`^${label}`) });
    expect(cont()).toBeDisabled();
    await app.user.click(box("All Financial Data"));
    for (const c of COLLECTIONS) expect(box(LABEL[c])).toBeChecked();
    expect(cont()).toBeEnabled();
    // unticking one child unticks "All" but keeps the rest
    await app.user.click(box("Alerts"));
    expect(box("All Financial Data")).not.toBeChecked();
    expect(box("Income Sources")).toBeChecked();
    // re-ticking it restores "All"
    await app.user.click(box("Alerts"));
    expect(box("All Financial Data")).toBeChecked();
    // unticking All clears everything
    await app.user.click(box("All Financial Data"));
    for (const c of COLLECTIONS) expect(box(LABEL[c])).not.toBeChecked();
    expect(cont()).toBeDisabled();
  }, 40_000);

  it("ticking all five children by hand ticks 'All' and reports the five labels in the confirmation", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const dialog = await openSelectiveReset(app, COLLECTIONS.map((c) => LABEL[c]));
    expect(within(dialog).getByRole("checkbox", { name: /^All Financial Data/ })).toBeChecked();
    await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog");
    expect(await within(confirm).findByText(/This will delete: Income Sources, Expense Rules, Transactions, Balance History, Alerts\. Type DELETE to confirm\./)).toBeInTheDocument();
  }, 40_000);

  it("the confirm step lists exactly the selected labels and demands the word DELETE, case-sensitively", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const dialog = await openSelectiveReset(app, ["Balance History", "Transactions"]);
    await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog");
    const text = await within(confirm).findByText(/This will delete:/);
    expect(text.textContent).toBe("This will delete: Balance History, Transactions. Type DELETE to confirm.");
    const go = within(confirm).getByRole("button", { name: "Reset Selected Data" });
    expect(go).toBeDisabled();
    const input = within(confirm).getByPlaceholderText(/Type "DELETE"/);
    await app.user.type(input, "delete");
    expect(go).toBeDisabled();
    await app.user.clear(input);
    await app.user.type(input, "DELETE");
    expect(go).toBeEnabled();
  }, 40_000);

  it("cancelling at either step deletes nothing and writes nothing", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const writes = app.store.__ops.length;
    // step 1 cancel
    let dialog = await openSelectiveReset(app, ["All Financial Data"]);
    await app.user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // step 2 cancel
    dialog = await openSelectiveReset(app, ["All Financial Data"]);
    await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog");
    await within(confirm).findByText(/Type DELETE to confirm/);
    await app.user.type(within(confirm).getByPlaceholderText(/Type "DELETE"/), "DELETE");
    await app.user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(app.store.__ops.length).toBe(writes);
    expect(countsOf(app, "user-1")).toEqual(ONE_EACH);
    expect(storedBalance(app)).toBe(9_000);
  }, 40_000);

  it("a backend failure during the reset is reported, leaves the data and balance alone, and shows no success message", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const dialog = await openSelectiveReset(app, ["Transactions"]);
    await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog");
    await within(confirm).findByText(/Type DELETE to confirm/);
    await app.user.type(within(confirm).getByPlaceholderText(/Type "DELETE"/), "DELETE");
    (store.getDocs as unknown as Mock).mockRejectedValueOnce(new Error("Firestore unavailable"));
    await app.user.click(within(confirm).getByRole("button", { name: "Reset Selected Data" }));
    expect(await screen.findByText("Firestore unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/reset successfully/)).not.toBeInTheDocument();
    expect(countsOf(app, "user-1")).toEqual(ONE_EACH);
    expect(storedBalance(app)).toBe(9_000);
  }, 40_000);
});

describe("Delete Account", () => {
  const openDelete = async (app: Awaited<ReturnType<typeof renderApp>>) => {
    await app.user.click(screen.getAllByRole("button", { name: "Delete Account" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/permanently delete your account/);
    return dialog;
  };

  it("requires the account's own email to be typed, then removes the user's data and profile (and only theirs)", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    seedBystander(app);
    const dialog = await openDelete(app);
    const go = within(dialog).getByRole("button", { name: "Delete My Account" });
    expect(go).toBeDisabled();
    const input = within(dialog).getByPlaceholderText(/Type "test@example.com"/);
    await app.user.type(input, "DELETE");
    expect(go).toBeDisabled();
    await app.user.clear(input);
    await app.user.type(input, "test@example.com");
    expect(go).toBeEnabled();
    await app.user.click(go);
    await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
    await app.settle();
    expect(countsOf(app, "user-1")).toEqual({ income_sources: 0, expense_rules: 0, transactions: 0, balance_history: 0, alerts: 0 });
    expect(app.store.__get("users", "user-1")).toBeUndefined();
    expect(app.router.push).toHaveBeenCalledWith("/login");
    // bystander intact
    expect(countsOf(app, "user-2")).toEqual(ONE_EACH);
    expect(app.store.__get("users", "user-2")).toBeDefined();
    // the deleted profile is not silently recreated
    expect(app.store.__get("users", "user-1")).toBeUndefined();
  }, 40_000);

  knownDefect(
    "UI-BAL-23",
    "when Firebase refuses to delete the auth user (requires-recent-login) the user's data and profile are already gone",
    async () => {
      // observed: error banner shown, but income_sources/expense_rules/transactions/alerts/users/{uid} are all deleted,
      // and the user is still signed in with an empty account.
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
      const dialog = await openDelete(app);
      await app.user.type(within(dialog).getByPlaceholderText(/Type "test@example.com"/), "test@example.com");
      app.auth.__failNext("deleteUser", new Error("Firebase: Error (auth/requires-recent-login)."));
      await app.user.click(within(dialog).getByRole("button", { name: "Delete My Account" }));
      // preconditions: the deletion was attempted, failed, and the user is told so
      await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
      expect(await screen.findByText(/requires-recent-login/)).toBeInTheDocument();
      expect(app.authContext().user).not.toBeNull(); // still signed in
      // money assertion: a failed deletion must not have destroyed anything
      expect(app.store.__get("users", "user-1")).toBeDefined();
      expect(countsOf(app, "user-1")).toEqual(ONE_EACH);
    },
    40_000
  );
});
