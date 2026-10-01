import { describe, expect, it } from "vitest";
import * as React from "react";
import {
  act,
  renderApp,
  screen,
  within,
  waitFor,
  knownDefect,
  makeCompletedTransaction,
  makeFakeUser,
  makeIncomeSource,
  makeUserProfile,
} from "../harness";
import {
  Screens,
  dashboardCurrent,
  expectBalanceInvariant,
  mismatchBanner,
  screenEl,
  settingsComputed,
  settingsCurrent,
  settingsInitial,
  storedBalance,
} from "./support";

/**
 * AuthContext / profile lifecycle: first login, legacy-profile migration,
 * login twice, sign-out, user switching, sign-up. Everything is observed through the
 * real providers and pages; the store is only read back to see what was persisted.
 */

type Profile = {
  uid: string;
  email: string;
  displayName: string;
  currentBalance: number;
  initialBalance?: number | null;
  balanceLastUpdatedAt: string;
  preferences: { currency: string; defaultWarningThreshold: number };
};
const profileOf = (app: { store: { __get: <T>(c: string, id: string) => T | undefined } }, uid: string) =>
  app.store.__get<Profile>("users", uid);

const relogin = async (app: Awaited<ReturnType<typeof renderApp>>, user = makeFakeUser()) => {
  await act(async () => {
    app.auth.__setUser(null);
  });
  await app.settle();
  await act(async () => {
    app.auth.__setUser(user);
  });
  await app.advance(1000);
  await waitFor(() => expect(app.authContext().loading).toBe(false));
  await app.settle();
};

describe("first login: profile creation", () => {
  it("a user with no profile document gets one: identity from auth, zero balance, initialBalance equal to it", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      user: { uid: "user-1", email: "ada@example.com", displayName: "Ada Lovelace" },
      seed: { profile: null },
    });
    const doc = profileOf(app, "user-1")!;
    expect(doc).toMatchObject({
      uid: "user-1",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      currentBalance: 0,
    });
    // nothing has happened yet, so the baseline IS the balance: the invariant holds from day one
    expect(doc.initialBalance).toBe(0);
    // exactly one write to users/{uid}: the creation (no follow-up migration write)
    expect(app.store.__opsFor("users").map((o) => o.op)).toEqual(["set"]);
    await expectBalanceInvariant(app, { balance: 0, completedCount: 0 }, "brand-new user");
    // the profile's currency drives both screens' symbol
    const symbol = { PHP: "₱", USD: "$" }[doc.preferences.currency as "PHP" | "USD"];
    expect(symbol).toBeDefined();
    expect(within(screenEl("settings")).getByText("Current").parentElement!.textContent).toContain(symbol);
    expect(within(screenEl("dashboard")).getByText("Current Balance").parentElement!.parentElement!.textContent).toContain(symbol);
  }, 40_000);

  it("falls back to the display name 'User' when the auth account has none, and the page shows it", async () => {
    const app = await renderApp({
      route: "/settings",
      user: { uid: "user-1", email: "anon@example.com", displayName: null },
      seed: { profile: null },
    });
    expect(profileOf(app, "user-1")?.displayName).toBe("User");
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getByText("anon@example.com")).toBeInTheDocument();
  });

  it("logging in with an existing profile never overwrites it", async () => {
    const app = await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 4_321.5, initialBalance: 1_000, displayName: "Kept Name", preferences: { currency: "GBP", defaultWarningThreshold: 123 } } },
    });
    const doc = profileOf(app, "user-1")!;
    expect(doc).toMatchObject({ displayName: "Kept Name", currentBalance: 4_321.5, initialBalance: 1_000 });
    expect(doc.preferences).toMatchObject({ currency: "GBP", defaultWarningThreshold: 123 });
    expect(app.store.__opsFor("users")).toEqual([]);
  });

  it("the Preferences form of a brand-new user starts from what was stored", async () => {
    const app = await renderApp({ route: "/settings", seed: { profile: null } });
    const stored = profileOf(app, "user-1")!;
    // (a Radix select: the trigger button shows the selected option's label, "PHP - Philippine Peso")
    expect(screen.getByLabelText("Currency").textContent).toContain(stored.preferences.currency);
    expect((screen.getByLabelText("Low Balance Warning Threshold") as HTMLInputElement).value).toBe(
      String(stored.preferences.defaultWarningThreshold)
    );
  });

  it(
    "UI-BAL-09 — balanceLastUpdatedAt is stamped with the UTC date, so a new profile created at 00:30 in Manila says 'yesterday'",
    async () => {
      // observed: "Last updated: 2026-01-14" at 2026-01-15 00:30 local (UTC+8)
      await renderApp({
        route: "/settings",
        timeZone: "Asia/Manila",
        today: "2026-01-15T00:30",
        seed: { profile: null },
      });
      expect(new Date().getTimezoneOffset()).toBe(-480);
      expect(new Date().getDate()).toBe(15);
      const label = screen.getByText(/^Last updated:/);
      // REWRITTEN (MANUAL-L5): the label follows the Date Format preference (default MM/DD/YYYY);
      // it used to print the stored ISO key.
      expect(label.textContent).toMatch(/^Last updated: \d{2}\/\d{2}\/\d{4}$/);
      expect(label.textContent).toBe("Last updated: 01/15/2026");
    }
  );

  it(
    "UI-BAL-10 — balanceLastUpdatedAt says TOMORROW for a profile created at 20:00 in New York",
    async () => {
      // observed: "Last updated: 2026-01-16" at 2026-01-15 20:00 local (UTC-5)
      await renderApp({
        route: "/settings",
        timeZone: "America/New_York",
        today: "2026-01-15T20:00",
        seed: { profile: null },
      });
      expect(new Date().getTimezoneOffset()).toBe(300);
      expect(new Date().getDate()).toBe(15);
      const label = screen.getByText(/^Last updated:/);
      // REWRITTEN (MANUAL-L5): the label follows the Date Format preference (default MM/DD/YYYY);
      // it used to print the stored ISO key.
      expect(label.textContent).toMatch(/^Last updated: \d{2}\/\d{2}\/\d{4}$/);
      expect(label.textContent).toBe("Last updated: 01/15/2026");
    }
  );
});

describe("sign-up and Google sign-in create the profile", () => {
  it("email sign-up through the real form creates users/{uid} with zero balances and goes to the dashboard", async () => {
    const app = await renderApp({ route: "/signup", user: null });
    await app.user.type(screen.getByLabelText("Email"), "new@example.com");
    await app.user.type(screen.getByLabelText("Password"), "hunter22");
    // REWRITTEN (MANUAL-g): the form now asks for the password twice
    await app.user.type(screen.getByLabelText("Confirm Password"), "hunter22");
    await app.user.click(screen.getByRole("button", { name: "Sign Up" }));
    await waitFor(() => expect(app.auth.__callsTo("createUserWithEmailAndPassword")).toHaveLength(1));
    expect(app.auth.__callsTo("createUserWithEmailAndPassword")[0].args).toEqual(["new@example.com", "hunter22"]);
    await waitFor(() => expect(app.store.__get("users", "new-user")).toBeDefined());
    await app.settle();
    expect(profileOf(app, "new-user")).toMatchObject({
      uid: "new-user",
      email: "new@example.com",
      currentBalance: 0,
      initialBalance: 0,
    });
    expect(app.router.push).toHaveBeenCalledWith("/dashboard");
    expect(app.store.__count("users")).toBe(1);
  });

  it("sign-up surfaces Firebase's weak-password and email-in-use errors in plain words and creates nothing", async () => {
    const app = await renderApp({ route: "/signup", user: null });
    await app.user.type(screen.getByLabelText("Email"), "new@example.com");
    // REWRITTEN (MANUAL-g): "123" is now stopped by the form itself (see signup validation below), so the
    // server-side weak-password message is exercised with a password that passes the client check
    await app.user.type(screen.getByLabelText("Password"), "123456");
    await app.user.type(screen.getByLabelText("Confirm Password"), "123456");
    app.auth.__failNext("createUserWithEmailAndPassword", new Error("Firebase: Error (auth/weak-password)."));
    await app.user.click(screen.getByRole("button", { name: "Sign Up" }));
    expect(await screen.findByText(/Password is too weak/)).toBeInTheDocument();
    app.auth.__failNext("createUserWithEmailAndPassword", new Error("Firebase: Error (auth/email-already-in-use)."));
    await app.user.click(screen.getByRole("button", { name: "Sign Up" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(app.store.__count("users")).toBe(0);
    expect(app.router.push).not.toHaveBeenCalled();
  });

  it("Google sign-in for a first-time user creates a zero-balance profile from the Google identity", async () => {
    const app = await renderApp({ route: "/login", user: null });
    await app.user.click(screen.getByRole("button", { name: /Sign in with Google/ }));
    await waitFor(() => expect(app.store.__get("users", "google-user")).toBeDefined());
    await app.settle();
    expect(profileOf(app, "google-user")).toMatchObject({
      email: "google@example.com",
      displayName: "Test User",
      currentBalance: 0,
      initialBalance: 0,
    });
    expect(app.router.push).toHaveBeenCalledWith("/dashboard");
  });

  it("email sign-in for a returning user shows their stored balance, not a fresh profile", async () => {
    const app = await renderApp({
      route: "/login",
      user: null,
      seed: {},
    });
    // returning user "test" (uid user-1, per the fake SDK) has a stored profile
    app.store.__seed("users", "user-1", makeUserProfile({ currentBalance: 555, initialBalance: 555 }));
    await app.user.type(screen.getByLabelText("Email"), "test@example.com");
    await app.user.type(screen.getByLabelText("Password"), "hunter22");
    await app.user.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() => expect(app.auth.__callsTo("signInWithEmailAndPassword")).toHaveLength(1));
    await app.settle();
    expect(profileOf(app, "user-1")?.currentBalance).toBe(555);
    expect(app.store.__opsFor("users")).toEqual([]);
  });
});

describe("legacy profile without initialBalance (migrateToInitialBalance)", () => {
  // History that already sits inside currentBalance:
  //   +20,000 income (Jan 2) and -2,000 expense (Jan 5) = +18,000 net.
  //   currentBalance 23,000 therefore implies a starting balance of 23,000 - 18,000 = 5,000.
  const legacy = {
    // (no `balanceModelVersion`: a document written before the versioned balance model)
    profile: { currentBalance: 23_000, initialBalance: undefined, balanceModelVersion: undefined },
    transactions: [
      makeCompletedTransaction({ id: "a", type: "income", projectedAmount: 20_000, scheduledDate: "2026-01-02" }),
      makeCompletedTransaction({ id: "b", type: "expense", projectedAmount: 2_000, scheduledDate: "2026-01-05" }),
    ],
  };

  it(
    "UI-BAL-11 — the migration seeds initialBalance from a currentBalance that already includes history, so Settings shows a permanent mismatch (Path B)",
    async () => {
      // observed: initialBalance 23,000 -> "Computed from 2 transactions: $41,000", banner quotes $18,000
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: legacy });
      // preconditions: the migration ran, the balance the user had is untouched
      expect(profileOf(app, "user-1")?.initialBalance).toBeDefined();
      expect(storedBalance(app)).toBe(23_000);
      expect(settingsCurrent()).toBe(23_000);
      // money assertions: baseline 5,000 => derived 5,000 + 18,000 = 23,000 = stored
      expect(settingsInitial()).toBe(5_000);
      expect(settingsComputed()).toBe(23_000);
      expect(mismatchBanner()).toBeNull();
    }
  );

  it(
    "UI-BAL-12 — …and pressing Recalculate Balance on that mismatch writes a balance 18,000 too HIGH (Path B)",
    async () => {
      // observed: users.currentBalance 23,000 -> 41,000 with one click
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: legacy });
      expect(storedBalance(app)).toBe(23_000);
      const button = screen.queryByRole("button", { name: /Recalculate Balance/ });
      if (!button) return; // banner absent: the defect is fixed
      await app.user.click(button);
      await screen.findByText("Balance updated successfully!");
      await app.settle();
      expect(storedBalance(app)).toBe(23_000);
    }
  );

  it("the migration writes exactly once (initialBalance + version stamp + updatedAt) on the first login", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: legacy });
    const writes = app.store.__opsFor("users");
    expect(writes).toHaveLength(1);
    expect(writes[0].op).toBe("update");
    // REWRITTEN (write-path stream, decision D1 "versioned" rebase): the one-time write also
    // stamps `balanceModelVersion`, which is what makes it run once and lets later logins skip
    // it. The old expectation listed only ["initialBalance", "updatedAt"].
    expect(Object.keys(writes[0].data ?? {}).sort()).toEqual(["balanceModelVersion", "initialBalance", "updatedAt"]);
    expect(writes[0].data?.balanceModelVersion).toBe(1);
    // the balance itself was not touched
    expect(storedBalance(app)).toBe(23_000);
  });

  it("logging in a second and third time does NOT re-run the migration (refutes 'runs on every login')", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: legacy });
    const firstInitial = profileOf(app, "user-1")?.initialBalance;
    expect(firstInitial).toBeDefined();
    const opsAfterFirst = app.store.__ops.length;
    await relogin(app);
    await relogin(app);
    expect(app.auth.__callsTo("signOut")).toEqual([]); // (state flips only; no SDK sign-out is needed)
    expect(app.store.__ops.length).toBe(opsAfterFirst);
    expect(profileOf(app, "user-1")?.initialBalance).toBe(firstInitial);
  });

  it("a user who repairs the baseline in Settings keeps it across later logins", async () => {
    const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: legacy });
    // the documented workaround: set the baseline to 5,000 by hand
    await app.user.click(screen.getByRole("button", { name: /Update Initial Balance/ }));
    await app.user.type(screen.getByLabelText("Set Initial Balance"), "5000");
    await app.user.click(screen.getByRole("button", { name: "Update Initial Balance" }));
    await app.user.click(await screen.findByRole("button", { name: "Update & Recalculate" }));
    await screen.findByText("Balance updated successfully!");
    await app.settle();
    // 5,000 + 20,000 - 2,000 = 23,000: the original balance is back, and now reconciles
    expect(profileOf(app, "user-1")?.initialBalance).toBe(5_000);
    expect(storedBalance(app)).toBe(23_000);
    expect(mismatchBanner()).toBeNull();
    await relogin(app);
    expect(profileOf(app, "user-1")?.initialBalance).toBe(5_000);
    expect(storedBalance(app)).toBe(23_000);
    expect(settingsComputed()).toBe(23_000);
  });

  it("a profile the OLD migration already seeded (initialBalance = currentBalance, history double counted) is rebased once, keeping the balance", async () => {
    // What production profiles that logged in before this fix look like: the old migration wrote
    // initialBalance = currentBalance = 23,000 although 18,000 of history is already inside it.
    // Rebase: initialBalance = 23,000 - (20,000 - 2,000) = 5,000; currentBalance stays 23,000.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: "2026-01-15",
      seed: { ...legacy, profile: { currentBalance: 23_000, initialBalance: 23_000, balanceModelVersion: undefined } },
    });
    expect(profileOf(app, "user-1")?.initialBalance).toBe(5_000);
    expect(storedBalance(app)).toBe(23_000);
    await expectBalanceInvariant(app, { balance: 23_000, completedCount: 2 }, "rebased");
    // idempotent: a further login writes nothing
    const opsAfterFirst = app.store.__ops.length;
    await relogin(app);
    expect(app.store.__ops.length).toBe(opsAfterFirst);
  }, 40_000);

  it("the rebase logs the discrepancy the old model had with console.info", async () => {
    const { vi } = await import("vitest");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await renderApp({
        route: "/settings",
        today: "2026-01-15",
        seed: { ...legacy, profile: { currentBalance: 23_000, initialBalance: 23_000, balanceModelVersion: undefined } },
      });
      const line = info.mock.calls.map((c) => String(c[0])).find((m) => m.includes("rebased initialBalance"));
      // old implied balance 23,000 + 18,000 = 41,000, i.e. 18,000 off the 23,000 the user sees
      expect(line).toContain("23000 -> 5000");
      expect(line).toContain("the old model implied 41000, off by 18000");
    } finally {
      info.mockRestore();
    }
  }, 40_000);

  it("a legacy profile with NO history migrates correctly: baseline = balance, nothing to reconcile", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard", "forecast"]} />,
      today: "2026-01-15",
      seed: { profile: { currentBalance: 640.25, initialBalance: undefined, balanceModelVersion: undefined } },
    });
    expect(profileOf(app, "user-1")?.initialBalance).toBe(640.25);
    await expectBalanceInvariant(app, { balance: 640.25, completedCount: 0 }, "legacy, no history");
  });

  it("initialBalance = 0 is a real baseline: it is not 'migrated' to currentBalance", async () => {
    // baseline 0 + completed income 500 = 500 = current. A falsy-check migration would seed 500 and double count.
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: "2026-01-15",
      seed: {
        profile: { currentBalance: 500, initialBalance: 0 },
        transactions: [makeCompletedTransaction({ id: "a", type: "income", projectedAmount: 500, scheduledDate: "2026-01-05" })],
      },
    });
    expect(profileOf(app, "user-1")?.initialBalance).toBe(0);
    expect(app.store.__opsFor("users")).toEqual([]);
    await expectBalanceInvariant(app, { balance: 500, completedCount: 1 }, "zero baseline");
  }, 40_000);

  it("an explicit null initialBalance is treated as missing and migrated", async () => {
    const app = await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 77, initialBalance: null as unknown as number } },
    });
    expect(profileOf(app, "user-1")?.initialBalance).toBe(77);
  });
});

describe("sign-out and user switching", () => {
  it("Logout in the sidebar signs out, clears the profile and sends the user to /login", async () => {
    const app = await renderApp({ route: "/settings", layout: true, seed: { profile: { currentBalance: 4_000, initialBalance: 4_000 } } });
    expect(app.authContext().userProfile?.currentBalance).toBe(4_000);
    const logout = screen.getAllByRole("button", { name: /Logout/ })[0];
    await app.user.click(logout);
    await waitFor(() => expect(app.auth.__callsTo("signOut")).toHaveLength(1));
    await waitFor(() => expect(app.router.push).toHaveBeenCalledWith("/login"));
    await app.settle();
    expect(app.authContext().user).toBeNull();
    expect(app.authContext().userProfile).toBeNull();
    // nothing about the previous session is left in the financial context
    expect(app.financial().userProfile).toBeNull();
    expect(screen.queryByText("Balance Management")).not.toBeInTheDocument();
    // sign-out never touched the stored data
    expect(profileOf(app, "user-1")?.currentBalance).toBe(4_000);
  });

  it("switching straight from user A to user B shows only B's balance and data (no leakage)", async () => {
    const app = await renderApp({
      ui: <Screens only={["settings", "dashboard"]} />,
      today: "2026-01-15",
      seed: {
        profile: { currentBalance: 1_111, initialBalance: 1_111 },
        incomeSources: [makeIncomeSource({ id: "a-inc", name: "A Salary" })],
        transactions: [makeCompletedTransaction({ id: "a-t", name: "A Coffee", scheduledDate: "2026-01-05", projectedAmount: 10, actualAmount: 10 })],
      },
    });
    expect(app.financial().incomeSources.map((s) => s.name)).toEqual(["A Salary"]);
    // B exists in the same database
    app.store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", email: "b@example.com", displayName: "Bea", currentBalance: 777, initialBalance: 777 }));
    app.store.__seed("income_sources", "b-inc", makeIncomeSource({ id: "b-inc", userId: "user-2", name: "B Salary" }));
    await act(async () => {
      app.auth.__setUser(makeFakeUser({ uid: "user-2", email: "b@example.com", displayName: "Bea" }));
    });
    await app.advance(1000);
    await waitFor(() => expect(app.authContext().userProfile?.uid).toBe("user-2"));
    await app.settle();
    expect(app.financial().userProfile?.uid).toBe("user-2");
    expect(app.financial().incomeSources.map((s) => s.name)).toEqual(["B Salary"]);
    expect(app.financial().transactions.map((t) => t.name)).not.toContain("A Coffee");
    expect(settingsCurrent(screenEl("settings"))).toBe(777);
    expect(dashboardCurrent()).toBe(777);
    expect(screen.queryByText("A Salary")).not.toBeInTheDocument();
    // A's document is untouched
    expect(profileOf(app, "user-1")?.currentBalance).toBe(1_111);
  }, 40_000);

  it("sign out then sign in as someone else: the second session's writes land in the second user's document", async () => {
    const app = await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 1_111, initialBalance: 1_111 } },
    });
    app.store.__seed("users", "user-2", makeUserProfile({ uid: "user-2", email: "b@example.com", displayName: "Bea", currentBalance: 777, initialBalance: 777 }));
    await relogin(app, makeFakeUser({ uid: "user-2", email: "b@example.com", displayName: "Bea" }));
    await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
    await app.user.type(screen.getByLabelText("Override Current Balance"), "800");
    await app.user.click(screen.getByRole("button", { name: "Override Balance" }));
    await screen.findByText("Balance updated successfully!");
    expect(profileOf(app, "user-2")?.currentBalance).toBe(800);
    expect(profileOf(app, "user-1")?.currentBalance).toBe(1_111);
  });
});

describe("balance override and the calendar date it stamps", () => {
  it(
    "UI-BAL-13 — Override Current Balance stamps 'Last updated' with the UTC date (yesterday at 00:30 in Manila)",
    async () => {
      // observed: "Last updated: 2026-01-14" right after overriding at 2026-01-15 00:30 local (UTC+8)
      const app = await renderApp({
        route: "/settings",
        timeZone: "Asia/Manila",
        today: "2026-01-15T00:30",
        seed: { profile: { currentBalance: 100, initialBalance: 100, balanceLastUpdatedAt: "2026-01-01" } },
      });
      // REWRITTEN (MANUAL-L5): the label follows the Date Format preference (default MM/DD/YYYY)
      expect(screen.getByText("Last updated: 01/01/2026")).toBeInTheDocument();
      await app.user.click(screen.getByRole("button", { name: /Override Current Balance/ }));
      await app.user.type(screen.getByLabelText("Override Current Balance"), "250");
      await app.user.click(screen.getByRole("button", { name: "Override Balance" }));
      await screen.findByText("Balance updated successfully!");
      await app.settle();
      expect(storedBalance(app)).toBe(250);
      const label = screen.getByText(/^Last updated: \d\d\/\d\d\/20\d\d$/);
      expect(label.textContent).toBe("Last updated: 01/15/2026");
    }
  );
});
