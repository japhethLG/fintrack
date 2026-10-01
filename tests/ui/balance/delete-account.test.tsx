import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  renderApp,
  screen,
  within,
  waitFor,
  makeAlert,
  makeBalanceSnapshot,
  makeExpenseRule,
  makeIncomeSource,
  makeManualTransaction,
  makeUserProfile,
} from "../harness";
import { takeFlashNotice } from "@/lib/utils/flashNotice";
import * as store from "../../helpers/firestoreEmulator";

/**
 * Delete Account: the ORDER and every failure point (UI-BAL-23).
 *
 * With real security rules every data write needs an authenticated caller, so the login must outlive the
 * data deletion, and the identity check must come first so `requires-recent-login` cannot strike midway:
 *
 *   (a) reauthenticate (password for email users, Google popup for Google users)
 *   (b) delete the data and the profile (one atomic batch)
 *   (c) delete the auth user
 *
 *  failure at (a): nothing deleted, still signed in, message says so
 *  failure at (b): nothing deleted, still signed in, message says so
 *  failure at (c): data is gone; the user is told plainly and signed out (the message rides to /login)
 */

const COLLECTIONS = ["income_sources", "expense_rules", "transactions", "balance_history", "alerts"] as const;

const world = () => ({
  profile: { currentBalance: 9_000, initialBalance: 10_000 },
  incomeSources: [makeIncomeSource({ id: "i1", name: "Salary", startDate: "2026-01-20" })],
  expenseRules: [makeExpenseRule({ id: "e1", name: "Rent", startDate: "2026-01-25" })],
  transactions: [
    makeManualTransaction({ id: "t1", name: "Groceries", status: "completed", projectedAmount: 1_000, actualAmount: 1_000, scheduledDate: "2026-01-05", actualDate: "2026-01-05" }),
  ],
  alerts: [makeAlert({ id: "al1" })],
  balanceHistory: [makeBalanceSnapshot({ id: "b1" })],
});

type App = Awaited<ReturnType<typeof renderApp>>;

/** Documents belonging to user-1 across every collection, plus the profile. */
const remaining = (app: { store: typeof store }) => ({
  docs: COLLECTIONS.reduce(
    (sum, c) => sum + app.store.__all<{ userId: string }>(c).filter((d) => d.userId === "user-1").length,
    0
  ),
  profile: app.store.__get("users", "user-1") !== undefined,
});
const EVERYTHING = { docs: 5, profile: true };
const NOTHING = { docs: 0, profile: false };

const openDelete = async (app: App) => {
  await app.user.click(screen.getAllByRole("button", { name: "Delete Account" }).at(-1)!);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByText(/permanently delete your account/);
  return dialog;
};

const confirmDeletion = async (app: App, dialog: HTMLElement, password?: string) => {
  await app.user.type(within(dialog).getByPlaceholderText(/Type "test@example.com"/), "test@example.com");
  if (password !== undefined) await app.user.type(within(dialog).getByLabelText("Current password"), password);
  await app.user.click(within(dialog).getByRole("button", { name: "Delete My Account" }));
};

const bystander = (app: { store: typeof store }) => {
  app.store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", email: "b@example.com", currentBalance: 555, initialBalance: 555 }));
  app.store.__seed("transactions", "t2", makeManualTransaction({ id: "t2", userId: "user-2" }));
};

describe("Delete Account: email user", () => {
  it("reauthenticates first, deletes the data second and the login last (and only this user's data)", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    bystander(app);
    // the world at the instant each auth call is made
    const seen: Record<string, ReturnType<typeof remaining>> = {};
    app.auth.__beforeCall("reauthenticateWithCredential", () => (seen.reauth = remaining(app)));
    app.auth.__beforeCall("deleteUser", () => (seen.deleteUser = remaining(app)));

    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog, "s3cret");
    await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
    await app.settle();

    // (a) the identity check carried the typed password and ran before anything was touched
    const reauth = app.auth.__callsTo("reauthenticateWithCredential");
    expect(reauth).toHaveLength(1);
    expect(reauth[0].args[0]).toMatchObject({ email: "test@example.com", password: "s3cret" });
    expect(seen.reauth).toEqual(EVERYTHING);
    // (b) the data was already gone when the login was deleted (it needs an authenticated caller)
    expect(seen.deleteUser).toEqual(NOTHING);
    // (c) order of auth calls: reauthenticate, then delete
    expect(app.auth.__calls.map((c) => c.fn).filter((f) => ["reauthenticateWithCredential", "deleteUser"].includes(f))).toEqual([
      "reauthenticateWithCredential",
      "deleteUser",
    ]);
    expect(remaining(app)).toEqual(NOTHING);
    expect(app.router.push).toHaveBeenCalledWith("/login");
    // the bystander is untouched
    expect(app.store.__get("users", "user-2")).toBeDefined();
    expect(app.store.__get("transactions", "t2")).toBeDefined();
  }, 60_000);

  it("(a) a wrong password deletes nothing and the user stays signed in", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    app.auth.__failNext("reauthenticateWithCredential", new Error("Firebase: Error (auth/wrong-password)."));
    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog, "nope");
    expect(await screen.findByText("Incorrect password. Nothing was deleted.")).toBeInTheDocument();
    expect(app.auth.__callsTo("deleteUser")).toHaveLength(0);
    expect(app.auth.__callsTo("signOut")).toHaveLength(0);
    expect(app.authContext().user).not.toBeNull();
    expect(remaining(app)).toEqual(EVERYTHING);
    expect(app.router.push).not.toHaveBeenCalledWith("/login");
  }, 60_000);

  it("(a) the confirmation cannot be submitted without a password", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    const dialog = await openDelete(app);
    await app.user.type(within(dialog).getByPlaceholderText(/Type "test@example.com"/), "test@example.com");
    expect(within(dialog).getByRole("button", { name: "Delete My Account" })).toBeDisabled();
    expect(app.auth.__callsTo("reauthenticateWithCredential")).toHaveLength(0);
    expect(remaining(app)).toEqual(EVERYTHING);
  }, 60_000);

  it("(b) a rejected data batch leaves the whole account and the login in place", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    app.store.__injectFault({ collection: "transactions", error: new Error("Firestore unavailable") });
    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog, "s3cret");
    expect(
      await screen.findByText(/Your account was not deleted: your data could not be removed \(Firestore unavailable\)\. Nothing was changed/)
    ).toBeInTheDocument();
    expect(app.auth.__callsTo("reauthenticateWithCredential")).toHaveLength(1); // (a) did run
    expect(app.auth.__callsTo("deleteUser")).toHaveLength(0); // (c) did not
    expect(app.authContext().user).not.toBeNull();
    expect(remaining(app)).toEqual(EVERYTHING);
  }, 60_000);

  it("(c) if only the login deletion fails the data is gone: the user is told plainly and signed out", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world() });
    app.auth.__failNext("deleteUser", new Error("Firebase: Error (auth/network-request-failed)."));
    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog, "s3cret");
    await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
    await waitFor(() => expect(app.auth.__callsTo("signOut")).toHaveLength(1));
    await app.settle();

    // (b) completed before (c) failed
    expect(remaining(app)).toEqual(NOTHING);
    // signed out, sent to the login page, and the message travels with them
    expect(app.authContext().user).toBeNull();
    expect(app.router.push).toHaveBeenCalledWith("/login");
    const notice = takeFlashNotice();
    expect(notice).toMatch(/Your data was deleted, but we could not remove your sign-in \(.*auth\/network-request-failed.*\)\./);
    expect(notice).toMatch(/You have been signed out/);
  }, 60_000);

  it("the login page shows that message to the signed-out user", async () => {
    sessionStorage.setItem("fintrack_flash_notice", "Your data was deleted, but we could not remove your sign-in (boom). You have been signed out.");
    await renderApp({ route: "/login", user: null, today: "2026-01-15" });
    expect(await screen.findByText(/Your data was deleted, but we could not remove your sign-in \(boom\)/)).toBeInTheDocument();
    // one-shot: read once
    expect(takeFlashNotice()).toBeNull();
  }, 60_000);
});

describe("Delete Account: Google user", () => {
  const googleUser = { providerData: [{ providerId: "google.com" }] };

  it("reauthenticates with the Google popup (no password field), then deletes the data, then the login", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world(), user: googleUser });
    const seen: Record<string, ReturnType<typeof remaining>> = {};
    app.auth.__beforeCall("reauthenticateWithPopup", () => (seen.popup = remaining(app)));
    app.auth.__beforeCall("deleteUser", () => (seen.deleteUser = remaining(app)));

    const dialog = await openDelete(app);
    expect(within(dialog).queryByLabelText("Current password")).not.toBeInTheDocument();
    await confirmDeletion(app, dialog);
    await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
    await app.settle();

    expect(app.auth.__callsTo("reauthenticateWithPopup")).toHaveLength(1);
    expect(app.auth.__callsTo("reauthenticateWithCredential")).toHaveLength(0);
    expect(seen.popup).toEqual(EVERYTHING);
    expect(seen.deleteUser).toEqual(NOTHING);
    expect(remaining(app)).toEqual(NOTHING);
  }, 60_000);

  it("(a) a closed Google popup deletes nothing", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world(), user: googleUser });
    app.auth.__failNext("reauthenticateWithPopup", new Error("Firebase: Error (auth/popup-closed-by-user)."));
    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog);
    expect(await screen.findByText("Google sign-in was cancelled or blocked. Nothing was deleted.")).toBeInTheDocument();
    expect(app.auth.__callsTo("deleteUser")).toHaveLength(0);
    expect(app.authContext().user).not.toBeNull();
    expect(remaining(app)).toEqual(EVERYTHING);
  }, 60_000);

  it("(c) a failing login deletion after the data is gone still signs the Google user out with a message", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: world(), user: googleUser });
    app.auth.__failNext("deleteUser", new Error("Firebase: Error (auth/internal-error)."));
    const dialog = await openDelete(app);
    await confirmDeletion(app, dialog);
    await waitFor(() => expect(app.auth.__callsTo("signOut")).toHaveLength(1));
    await app.settle();
    expect(remaining(app)).toEqual(NOTHING);
    expect(app.authContext().user).toBeNull();
    expect(takeFlashNotice()).toMatch(/Your data was deleted, but we could not remove your sign-in/);
  }, 60_000);
});
