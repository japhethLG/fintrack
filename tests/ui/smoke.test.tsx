import { describe, expect, it, vi } from "vitest";
import {
  renderApp,
  screen,
  within,
  waitFor,
  moneyNear,
  blockedRequests,
  makeExpenseRule,
  makeIncomeSource,
} from "./harness";

/**
 * Smoke suite: proves the harness itself. If one of these fails, suspect the
 * harness (or the app's provider chain) before suspecting a page.
 */

describe("harness smoke", () => {
  it("(a) Dashboard renders the real providers with seeded profile, income and expense", async () => {
    const app = await renderApp({
      route: "/dashboard",
      today: "2026-01-15",
      seed: {
        profile: { currentBalance: 10_000 },
        incomeSources: [
          makeIncomeSource({
            id: "inc-1",
            name: "Acme Payroll",
            amount: 3_000,
            startDate: "2026-01-20",
          }),
        ],
        expenseRules: [
          makeExpenseRule({
            id: "exp-1",
            name: "Flat Rent",
            amount: 1_200,
            startDate: "2026-01-18",
          }),
        ],
      },
    });

    // Contexts loaded from the seeded store, not from defaults.
    expect(app.financial().incomeSources).toHaveLength(1);
    expect(app.financial().expenseRules).toHaveLength(1);
    expect(app.financial().userProfile?.currentBalance).toBe(10_000);

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    // Seeded names surface in "Upcoming Activity" (next 14 days from Jan 15).
    expect(screen.getByText("Acme Payroll")).toBeInTheDocument();
    expect(screen.getByText("Flat Rent")).toBeInTheDocument();

    // Money read off the screen, parsed independently of the app's formatter.
    expect(moneyNear("Current Balance")).toBe(10_000);
    expect(moneyNear("Total Income")).toBe(3_000);
    expect(moneyNear("Total Expenses")).toBe(-1_200);
    expect(moneyNear("Net Flow")).toBe(1_800);

    // The frozen clock drives the default period.
    expect(screen.getByText(/Financial overview for Jan 1 - Jan 31, 2026/)).toBeInTheDocument();
    expect(blockedRequests).toHaveLength(0);
  });

  it("(b) a user action through the real form persists to the store", async () => {
    const app = await renderApp({ route: "/transactions", today: "2026-01-15" });
    expect(app.store.__all("transactions")).toHaveLength(0);

    await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
    const dialog = await screen.findByRole("dialog");
    // The modal body is React.lazy: the dialog shell exists before the form does.
    await app.user.type(await within(dialog).findByLabelText(/^Name/), "Coffee Beans");
    await app.user.type(within(dialog).getByLabelText(/^Amount/), "12.50");
    await app.user.click(within(dialog).getByRole("button", { name: "Create Transaction" }));

    await waitFor(() => expect(app.store.__all("transactions")).toHaveLength(1));
    const [saved] = app.store.__all<Record<string, unknown>>("transactions");
    expect(saved).toMatchObject({
      userId: "user-1",
      sourceType: "manual",
      name: "Coffee Beans",
      type: "expense",
      projectedAmount: 12.5,
      scheduledDate: "2026-01-15",
      status: "projected",
    });

    // The live subscription pushed the new row back into the context and page.
    await waitFor(() =>
      expect(app.financial().transactions.map((t) => t.name)).toContain("Coffee Beans")
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Coffee Beans")).toBeInTheDocument();
  });

  it("(c) Settings balance section renders the stored balance", async () => {
    await renderApp({
      route: "/settings",
      seed: { profile: { currentBalance: 4_321.5, initialBalance: 1_000 } },
    });
    expect(moneyNear("Current")).toBe(4_321.5);
    expect(moneyNear("Starting Balance (Baseline)")).toBe(1_000);
  });

  it("(d) no network escapes: fetch, XHR and sockets are blocked and recorded", async () => {
    await renderApp({ route: "/dashboard" });
    expect(blockedRequests).toHaveLength(0);

    // `.invalid` is a reserved TLD: even if the guard were broken this could not resolve.
    await expect(fetch("https://firestore.example.invalid/v1/projects/x")).rejects.toThrow(
      /NETWORK BLOCKED/
    );
    const xhr = new XMLHttpRequest();
    expect(() => xhr.open("GET", "https://example.invalid/")).toThrow(/NETWORK BLOCKED/);
    expect(blockedRequests.map((r) => r.kind)).toEqual(["fetch", "xhr"]);

    // Deliberate probes are consumed here; setup.ts fails any test that leaves
    // blocked requests behind.
    blockedRequests.length = 0;
  });

  it("(e) the real Firebase config never executes and no credentials are visible", async () => {
    const config = await import("@/lib/firebase/config");
    expect((config.default as unknown as { __kind: string }).__kind).toBe("fake-app");
    expect(Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"))).toEqual([]);
  });

  it("(f) signed out: the real ProtectedRoute redirects to /login", async () => {
    const app = await renderApp({ route: "/dashboard", user: null, layout: true });
    await waitFor(() => expect(app.router.push).toHaveBeenCalledWith("/login"));
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("(g) frozen time: Date and fake timers are controlled", async () => {
    const app = await renderApp({ today: "2026-03-10" });
    expect(new Date().getFullYear()).toBe(2026);
    expect(new Date().getMonth()).toBe(2);
    expect(new Date().getDate()).toBe(10);
    const before = Date.now();
    await app.advance(60_000);
    expect(Date.now() - before).toBeGreaterThanOrEqual(60_000);
    expect(vi.isFakeTimers()).toBe(true);
  });
});
