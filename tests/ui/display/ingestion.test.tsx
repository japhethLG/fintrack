import { describe, expect, it } from "vitest";
import * as React from "react";
import { renderApp, screen, within, makeExpenseRule, makeIncomeSource, makeManualTransaction } from "../harness";
import { Screens, screenEl } from "../balance/support";
import DataIssuesNotice from "@/components/DataIssuesNotice";

/**
 * Hostile / legacy documents at the ingestion boundary (E2E-ROB-09 / ROB-10).
 *
 * A rule with a null amount used to crash the Calendar ("Cannot read properties of null (reading
 * toLocaleString)") and a non-numeric amount printed NaN on five screens. The subscription now repairs such
 * records (amount 0, rule switched off), keeps them visible, and shows a non-blocking notice.
 */

const TODAY = "2026-03-10";

const everything = () => (
  <>
    <DataIssuesNotice />
    <Screens only={["dashboard", "calendar", "forecast"]} />
  </>
);

const seedWith = (badAmount: unknown) => ({
  profile: { currentBalance: 1_000, initialBalance: 1_000 },
  incomeSources: [makeIncomeSource({ id: "pay", name: "Payroll", amount: 2_000, startDate: "2026-03-20" })],
  expenseRules: [
    makeExpenseRule({ id: "bad", name: "Broken Bill", amount: badAmount as never, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } }),
    makeExpenseRule({ id: "ok", name: "Rent", amount: 700, startDate: "2026-03-15", scheduleConfig: { dayOfMonth: 15 } }),
  ],
});

describe.each([
  ["null", null],
  ["a non-numeric string", "abc"],
  ["NaN", NaN],
])("an expense rule whose amount is %s", (_name, badAmount) => {
  it("does not crash any screen, prints no NaN, and tells the user", async () => {
    const app = await renderApp({ ui: everything(), today: TODAY, seed: seedWith(badAmount) });

    // preconditions: the page rendered and the valid neighbours are intact
    expect(within(screenEl("calendar")).getByText("March 2026")).toBeInTheDocument();
    expect(app.financial().expenseRules).toHaveLength(2);
    const rent = app.financial().transactions.filter((t) => t.name === "Rent");
    // a monthly rule has one row per month of the view window; each is the stored 700
    expect(rent.length).toBeGreaterThan(0);
    expect(rent.every((t) => t.projectedAmount === 700)).toBe(true);

    // money assertion: no screen prints NaN / undefined / null
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/NaN|undefined|null/);

    // the broken rule is repaired in memory: amount 0, switched off, so it projects nothing
    const broken = app.financial().expenseRules.find((r) => r.id === "bad")!;
    expect(broken.amount).toBe(0);
    expect(broken.isActive).toBe(false);
    expect(app.financial().transactions.some((t) => t.name === "Broken Bill")).toBe(false);

    // not silently: a non-blocking notice names it
    const notice = screen.getByTestId("data-issues-notice");
    expect(notice.textContent).toContain("1 item has invalid data");
    expect(notice.textContent).toContain("Broken Bill");

    // and the stored document is untouched (nothing is written back)
    expect(app.store.__get<{ amount: unknown }>("expense_rules", "bad")?.amount).toEqual(badAmount);
    expect(app.store.__opsFor("expense_rules")).toHaveLength(0);
  }, 30_000);
});

describe("a stored transaction with a hostile amount", () => {
  it("is shown as 0, flagged, and keeps the ledger finite", async () => {
    const app = await renderApp({
      ui: everything(),
      today: TODAY,
      seed: {
        profile: { currentBalance: 1_000, initialBalance: 1_000 },
        transactions: [
          makeManualTransaction({ id: "t1", name: "Odd Row", type: "expense", status: "completed", projectedAmount: null as never, actualAmount: "oops" as never, scheduledDate: "2026-03-05", actualDate: "2026-03-05" }),
          makeManualTransaction({ id: "t2", name: "Fine Row", type: "expense", status: "completed", projectedAmount: 40, actualAmount: 40, scheduledDate: "2026-03-06", actualDate: "2026-03-06" }),
        ],
      },
    });
    expect(app.financial().storedTransactions).toHaveLength(2);
    // ledger: 0 (repaired) + -40 = -40, finite (a NaN here would poison the balance check)
    expect(app.financial().ledger).toEqual({ completedCount: 2, sum: -40 });
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/);
    expect(screen.getByTestId("data-issues-notice").textContent).toContain("1 item has invalid data");
  }, 30_000);
});

describe("clean data", () => {
  it("shows no notice", async () => {
    await renderApp({ ui: everything(), today: TODAY, seed: { profile: { currentBalance: 1_000, initialBalance: 1_000 } } });
    expect(screen.queryByTestId("data-issues-notice")).not.toBeInTheDocument();
  }, 30_000);
});
