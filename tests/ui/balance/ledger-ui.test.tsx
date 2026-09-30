import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  act,
  renderApp,
  screen,
  within,
  waitFor,
  makeCompletedTransaction,
  makeExpenseRule,
  makeFakeUser,
  makeManualTransaction,
  makeUserProfile,
} from "../harness";
import { Screens, expectBalanceInvariant, mismatchBanner, screenEl, settingsComputed } from "./support";

/**
 * The write path as the user meets it: Settings reads the ledger from every STORED row, a dialog
 * cannot outlive its session, and account deletion / reset report exactly what happened.
 * Hand-derived numbers only.
 */

const TODAY = "2026-01-15";

describe("Settings reads the ledger from every stored completed row, not from the view window", () => {
  it("history older than the projection window is counted: no mismatch banner, 'Computed from 2 transactions'", async () => {
    // default window starts 2025-11-01, so both rows below are OUTSIDE it.
    // 10,000 - 500 + 200 = 9,700 = stored balance; a windowed derivation would say 10,000.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 9_700, initialBalance: 10_000 },
        transactions: [
          makeManualTransaction({ id: "old1", type: "expense", status: "completed", projectedAmount: 500, actualAmount: 500, scheduledDate: "2025-06-05", actualDate: "2025-06-05" }),
          makeManualTransaction({ id: "old2", type: "income", status: "completed", projectedAmount: 200, actualAmount: 200, scheduledDate: "2025-07-05", actualDate: "2025-07-05" }),
        ],
      },
    });
    await expectBalanceInvariant(app, { balance: 9_700, completedCount: 2 }, "old history");
    expect(settingsComputed(screenEl("settings"))).toBe(9_700);
  });

  it("Recalculate repairs a balance that drifted in either direction to initial + ALL stored completed rows", async () => {
    // initial 1,000; one old completed expense of 100 => the ledger says 900. Stored balance was edited to 5,000.
    const app = await renderApp({
      ui: <Screens only={["settings"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 5_000, initialBalance: 1_000 },
        transactions: [makeCompletedTransaction({ id: "c1", sourceType: "manual", type: "expense", projectedAmount: 100, scheduledDate: "2025-03-01" })],
      },
    });
    expect(mismatchBanner(screenEl("settings"))).toBe(4_100); // |5,000 - 900|
    await app.user.click(within(screenEl("settings")).getByRole("button", { name: /Recalculate Balance/ }));
    await within(screenEl("settings")).findByText("Balance updated successfully!");
    await app.settle();
    await expectBalanceInvariant(app, { balance: 900, completedCount: 1 }, "recalculated");
  });
});

describe("a dialog belongs to the session that opened it (E2E-ROB-07)", () => {
  it("an open transaction dialog closes when another user signs in, and nothing is written for either user", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings"]} />,
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_111, initialBalance: 1_111 },
        transactions: [makeManualTransaction({ id: "ta", name: "Alice Coffee", projectedAmount: 7, scheduledDate: "2026-01-10" })],
      },
    });
    app.store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", email: "b@example.com", displayName: "Bea", currentBalance: 2_222, initialBalance: 2_222 }));
    await act(async () => {
      app.openModal("TransactionModal", { transaction: app.store.__get("transactions", "ta") });
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    const opsBefore = app.store.__ops.length;
    await act(async () => {
      app.auth.__setUser(makeFakeUser({ uid: "user-2", email: "b@example.com", displayName: "Bea" }));
    });
    await app.advance(1000);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await app.settle();

    expect(app.store.__get<{ currentBalance: number }>("users", "user-2")?.currentBalance).toBe(2_222);
    expect(app.store.__get<{ currentBalance: number }>("users", "user-1")?.currentBalance).toBe(1_111);
    expect(app.store.__get<{ status: string }>("transactions", "ta")?.status).toBe("projected");
    // the only writes since were none of the dialog's
    expect(app.store.__ops.slice(opsBefore).filter((o) => o.collection === "transactions")).toEqual([]);
  }, 60_000);
});

describe("account deletion and resets report exactly what happened", () => {
  const world = {
    profile: { currentBalance: 9_000, initialBalance: 10_000 },
    expenseRules: [makeExpenseRule({ id: "e1", name: "Rent", startDate: "2026-01-25" })],
    transactions: [makeManualTransaction({ id: "t1", name: "Groceries", status: "completed", projectedAmount: 1_000, actualAmount: 1_000, scheduledDate: "2026-01-05", actualDate: "2026-01-05" })],
  };

  it("when the login is deleted but the data batch is then rejected, the user is told their data remains", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY, seed: world });
    await app.user.click(screen.getAllByRole("button", { name: "Delete Account" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/permanently delete your account/); // (the body is lazy)
    await app.user.type(within(dialog).getByPlaceholderText(/Type "test@example.com"/), "test@example.com");
    app.store.__injectFault({ collection: "transactions", error: new Error("Firestore unavailable") });
    await app.user.click(within(dialog).getByRole("button", { name: "Delete My Account" }));
    expect(await screen.findByText(/Your sign-in was deleted, but your stored data could not be removed \(Firestore unavailable\)/)).toBeInTheDocument();
    // one batch: nothing was half-deleted
    expect(app.store.__count("transactions")).toBe(1);
    expect(app.store.__count("expense_rules")).toBe(1);
    expect(app.store.__get("users", "user-1")).toBeDefined();
  }, 60_000);

  it("a 'Transactions' reset whose batch is rejected leaves rows, balance and baseline exactly as they were", async () => {
    const app = await renderApp({ route: "/settings", today: TODAY, seed: world });
    await app.user.click(screen.getByRole("button", { name: /Selective Reset/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Choose which financial data/); // (the body is lazy)
    await app.user.click(within(dialog).getByRole("checkbox", { name: /^Transactions/ }));
    await app.user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("dialog");
    await within(confirm).findByText(/Type DELETE to confirm/);
    await app.user.type(within(confirm).getByPlaceholderText(/Type "DELETE"/), "DELETE");
    app.store.__injectFault({ collection: "transactions", error: new Error("Firestore unavailable") });
    await app.user.click(within(confirm).getByRole("button", { name: "Reset Selected Data" }));
    expect(await screen.findByText("Firestore unavailable")).toBeInTheDocument();
    expect(app.store.__count("transactions")).toBe(1);
    expect(app.store.__get("users", "user-1")).toMatchObject({ currentBalance: 9_000, initialBalance: 10_000 });
  }, 60_000);
});
