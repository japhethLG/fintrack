import { describe, expect, it } from "vitest";
import {
  renderApp,
  screen,
  within,
  waitFor,
  knownDefect,
  moneyNear,
  consoleCalls,
  makeBalanceSnapshot,
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
} from "./harness";

/**
 * DEFECTS OBSERVED WHILE BUILDING THE HARNESS.
 *
 * Every test here was reproduced by rendering the real page; nothing is copied
 * from the audit docs. Each asserts the CORRECT behaviour under `knownDefect`
 * (see tests/ui/README.md), asserts its preconditions first so a crash cannot
 * masquerade as "defect still present", and records the observed wrong value.
 *
 *   FLIP_KNOWN_DEFECTS=1 npm run test:ui     # failures = defects still present
 */

describe("Forecast page", () => {
  const monthlyPlan = {
    incomeSources: [
      makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, startDate: "2026-01-01" }),
    ],
    expenseRules: [
      makeExpenseRule({ id: "rent", name: "Rent", amount: 1_200, startDate: "2026-01-01" }),
    ],
  };

  knownDefect(
    "UI-OBS-01",
    "Budgeted income for a 31-day month is prorated by days/30, so a $3,000 monthly salary budgets $3,100",
    async () => {
      // observed: Budgeted income $3,100 and expenses $1,240 (amount x 31/30), shown as a
      // -3.2% variance on a plan that was met exactly. Feb (28 days) would budget $2,800.
      await renderApp({ route: "/forecast", today: "2026-01-15", seed: monthlyPlan });
      const card = screen.getByText(/Budgeted vs Actual \(January 2026\)/).parentElement!
        .parentElement!;
      // Preconditions: the Actual side shows the plan was met, so Budgeted must equal it.
      expect(moneyNear("Actual", { within: card, occurrence: 0 })).toBe(3_000);
      expect(moneyNear("Actual", { within: card, occurrence: 1 })).toBe(1_200);
      expect(moneyNear("Budgeted", { within: card, occurrence: 0 })).toBe(3_000);
      expect(moneyNear("Budgeted", { within: card, occurrence: 1 })).toBe(1_200);
    }
  );
});

describe("Settings page", () => {
  knownDefect(
    "UI-OBS-02",
    "Low Balance Warning Threshold input is prefixed with a hard-coded peso sign for a USD user",
    async () => {
      // observed: prefix "₱" while every other amount on the page renders "$"
      await renderApp({
        route: "/settings",
        seed: { profile: { preferences: { currency: "USD" } } },
      });
      expect(moneyNear("Current")).toBe(10_000); // page rendered, USD profile
      const input = screen.getByLabelText("Low Balance Warning Threshold");
      const prefix = input.parentElement!.textContent ?? "";
      expect(prefix).toContain("$");
      expect(prefix).not.toContain("₱");
    }
  );

  knownDefect(
    "UI-OBS-03",
    "Saving a Low Balance Warning Threshold of 0 stores 500 (falsy `|| 500` fallback)",
    async () => {
      // observed: users/user-1.preferences.defaultWarningThreshold === 500 after saving 0
      const app = await renderApp({ route: "/settings" });
      expect(
        app.store.__get<{ preferences: { defaultWarningThreshold: number } }>("users", "user-1")
          ?.preferences.defaultWarningThreshold
      ).toBe(500); // seed default

      const input = screen.getByLabelText("Low Balance Warning Threshold");
      await app.user.clear(input);
      await app.user.type(input, "0");
      await app.user.click(await screen.findByRole("button", { name: "Save Preferences" }));
      await waitFor(() =>
        expect(screen.getByText("Preferences saved successfully!")).toBeInTheDocument()
      );

      const saved = app.store.__get<{ preferences: { defaultWarningThreshold: number } }>(
        "users",
        "user-1"
      );
      expect(saved?.preferences.defaultWarningThreshold).toBe(0);
    }
  );

  /** One stored completed transaction, one stored snapshot, and a rule that projects more rows. */
  const resetSeed = {
    expenseRules: [makeExpenseRule({ startDate: "2026-01-10" })],
    transactions: [makeCompletedTransaction({ id: "t1", scheduledDate: "2026-01-05" })],
    balanceHistory: [makeBalanceSnapshot({ id: "b1" })],
  };

  const openSelectiveReset = async (app: Awaited<ReturnType<typeof renderApp>>) => {
    // Preconditions: exactly 1 stored transaction and 1 snapshot; projections exist on top.
    expect(app.store.__count("transactions")).toBe(1);
    expect(app.store.__count("balance_history")).toBe(1);
    expect(app.financial().transactions.length).toBeGreaterThan(1);
    await app.user.click(screen.getByRole("button", { name: /Selective Reset/ }));
    return screen.findByRole("dialog");
  };

  knownDefect(
    "UI-OBS-04",
    "Selective Reset counts derived projections as deletable Transactions (1 stored row shows as 5 items)",
    async () => {
      // observed: "Projected and completed items • 5 items" — 1 stored + 4 generated projections
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: resetSeed });
      const dialog = await openSelectiveReset(app);
      const row = (await within(dialog).findByText(/Projected and completed items/)).textContent;
      expect(row).toMatch(/• 1 item$/);
    }
  );

  knownDefect(
    "UI-OBS-05",
    "Selective Reset always shows 0 Balance History items even when snapshots are stored",
    async () => {
      // observed: "Daily balance snapshots • 0 items" with 1 stored balance_history document
      const app = await renderApp({ route: "/settings", today: "2026-01-15", seed: resetSeed });
      const dialog = await openSelectiveReset(app);
      const row = (await within(dialog).findByText(/Daily balance snapshots/)).textContent;
      expect(row).toMatch(/• 1 item$/);
    }
  );
});

describe("Modals", () => {
  knownDefect(
    "UI-OBS-06",
    "Every modal Dialog.Content is missing a Description (Radix accessibility warning)",
    async () => {
      // observed: console.warn "Missing `Description` or `aria-describedby={undefined}` for {DialogContent}."
      const app = await renderApp({ route: "/transactions" });
      await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByLabelText(/^Name/); // form mounted
      const warned = consoleCalls().some((c) => /Missing `Description`/.test(c.message));
      expect(warned).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// Time-zone defects: they only manifest EAST of UTC. `timeZone` switches the
// zone for the test, so they run (and are pinned) in the default UTC run too.
// ---------------------------------------------------------------------------
describe("UTC+8 (Asia/Manila)", () => {
  it(
    "UI-OBS-07 — the projection window ends a day early: a bill due on the last day of the 4-month lookahead never appears",
    async () => {
      // observed: viewDateRange = { start: "2025-10-31", end: "2026-04-29" } (toISOString of local midnight)
      const app = await renderApp({
        route: "/transactions",
        today: "2026-01-15",
        timeZone: "Asia/Manila",
        seed: {
          expenseRules: [
            makeExpenseRule({
              id: "edge",
              name: "Edge Bill",
              frequency: "one-time",
              startDate: "2026-04-30",
            }),
          ],
        },
      });
      expect(new Date().getTimezoneOffset()).toBe(-480); // really running in UTC+8
      expect(app.financial().expenseRules).toHaveLength(1);
      expect(app.financial().transactions.map((t) => t.scheduledDate)).toContain("2026-04-30");
      expect(app.financial().viewDateRange).toEqual({ start: "2025-11-01", end: "2026-04-30" });
    }
  );

  it(
    "UI-OBS-08 — Add Transaction defaults the date to YESTERDAY between 00:00 and 08:00 local",
    async () => {
      // observed: Date input value "2026-01-14" at 00:30 local on 2026-01-15
      const app = await renderApp({
        route: "/transactions",
        today: "2026-01-15T00:30",
        timeZone: "Asia/Manila",
      });
      expect(new Date().getDate()).toBe(15); // local clock says the 15th
      await app.user.click(screen.getByRole("button", { name: /add transaction/i }));
      const dialog = await screen.findByRole("dialog");
      const date = (await within(dialog).findByLabelText(/^Date/)) as HTMLInputElement;
      expect(date.value).toBe("2026-01-15");
    }
  );
});
