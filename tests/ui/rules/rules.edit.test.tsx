import { describe, expect, it, vi } from "vitest";
import {
  renderApp,
  screen,
  act,
  waitFor,
  knownDefect,
  makeIncomeSource,
  makeExpenseRule,
  makeLoanRule,
  makeInstallmentRule,
  makeCompletedTransaction,
  type AppHandle,
} from "../harness";
import * as d from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * EDITING, DEACTIVATING AND DELETING persisted rules through the real manager screens.
 * Expected values come from first principles (a rename must not change money state; a deactivated
 * rule stays deactivated; history survives deleting the rule that produced it).
 */

const TODAY = "2026-01-15";

const balanceAfter = (principal: number, annualPct: number, n: number, k: number) => {
  const r = annualPct / 100 / 12;
  const emi = d.pmt(principal, annualPct, n);
  return principal * Math.pow(1 + r, k) - (emi * (Math.pow(1 + r, k) - 1)) / r;
};

async function widenWindow(app: AppHandle) {
  await act(async () => {
    app.financial().setViewDateRange("2025-01-01", "2032-12-31");
  });
  await app.settle();
}

/** Step 1 -> step 2 of the edit wizard. */
async function toDetails(app: AppHandle) {
  await d.next(app);
}

// ===========================================================================
describe("editing a loan that already has payments made", () => {
  const EMI = d.pmt(12_000, 12, 24);
  const BAL5 = d.cents(balanceAfter(12_000, 12, 24, 5)); // balance after 5 payments

  const seed = () => ({
    expenseRules: [
      makeLoanRule(
        { id: "loan-1", name: "Car Loan", amount: EMI, startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 10 } },
        {
          principalAmount: 12_000,
          currentBalance: BAL5,
          interestRate: 12,
          termMonths: 24,
          monthlyPayment: EMI,
          firstPaymentDate: "2026-02-10",
          paymentsMade: 5,
        }
      ),
    ],
  });

  async function rename() {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await widenWindow(app);
    const before = d.engineRows(app, "loan-1").length;
    await d.openEdit(app, "Car Loan");
    await toDetails(app);
    await d.fill(app, /^Loan Name/, "Car Loan (renamed)");
    await d.saveEdit(app);
    return { app, before, doc: d.ruleDocs(app)[0] };
  }

  it("the rename is saved and the remaining balance is preserved", async () => {
    const { doc } = await rename();
    expect(doc.name).toBe("Car Loan (renamed)");
    expect(doc.loanConfig.currentBalance).toBeCloseTo(BAL5, 2);
    expect(doc.loanConfig.principalAmount).toBe(12_000);
    expect(doc.startDate).toBe("2026-02-10");
    expect(doc.expenseType).toBe("cash_loan");
  });

  knownDefect(
    "UI-RULE-56",
    "renaming a loan resets loanConfig.paymentsMade from 5 to 0",
    async () => {
      // observed: paymentsMade 0 (the edit wizard rebuilds loanConfig with a hard-coded paymentsMade: 0)
      const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
      expect(d.ruleDocs(app)[0].loanConfig.paymentsMade).toBe(5); // precondition
      await d.openEdit(app, "Car Loan");
      await toDetails(app);
      await d.fill(app, /^Loan Name/, "Car Loan (renamed)");
      await d.saveEdit(app);
      const doc = d.ruleDocs(app)[0];
      expect(doc.name).toBe("Car Loan (renamed)"); // precondition: the save happened
      expect(doc.loanConfig.paymentsMade).toBe(5);
    }
  );

  knownDefect(
    "UI-RULE-57",
    "renaming a loan re-projects all 24 payments instead of the 19 that remain",
    async () => {
      // observed: 19 rows before the rename, 24 after (5 already-paid payments come back)
      const { app, before, doc } = await rename();
      expect(before).toBe(19); // precondition: 24 - 5 paid
      expect(doc.name).toBe("Car Loan (renamed)");
      await widenWindow(app);
      expect(d.engineRows(app, "loan-1")).toHaveLength(19);
    }
  );
});

// ===========================================================================
describe("editing an installment plan that already has payments made", () => {
  const seed = () => ({
    expenseRules: [
      makeInstallmentRule(
        { id: "inst-1", name: "Laptop BNPL", amount: 200, startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 10 } },
        { totalAmount: 1200, installmentCount: 6, installmentAmount: 200, installmentsPaid: 3 }
      ),
    ],
  });

  async function rename() {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await widenWindow(app);
    const before = d.engineRows(app, "inst-1").length;
    await d.openEdit(app, "Laptop BNPL");
    await toDetails(app);
    await d.fill(app, /^Item Name/, "Laptop (renamed)");
    await d.saveEdit(app);
    return { app, before, doc: d.ruleDocs(app)[0] };
  }

  it("the rename is saved and the plan terms are preserved", async () => {
    const { doc } = await rename();
    expect(doc.name).toBe("Laptop (renamed)");
    expect(doc.installmentConfig).toMatchObject({ totalAmount: 1200, installmentCount: 6, installmentAmount: 200 });
    expect(doc.isActive).toBe(true);
  });

  knownDefect(
    "UI-RULE-58",
    "renaming an installment plan resets installmentsPaid from 3 to 0",
    async () => {
      // observed: installmentsPaid 0
      const { doc } = await rename();
      expect(doc.name).toBe("Laptop (renamed)"); // precondition
      expect(doc.installmentConfig.installmentsPaid).toBe(3);
    }
  );

  knownDefect(
    "UI-RULE-59",
    "renaming an installment plan re-bills the 3 instalments already paid (3 -> 6 remaining bills)",
    async () => {
      const { app, before, doc } = await rename();
      expect(before).toBe(3); // precondition: 6 - 3 paid
      expect(doc.name).toBe("Laptop (renamed)");
      await widenWindow(app);
      expect(d.engineRows(app, "inst-1")).toHaveLength(3);
    }
  );
});

// ===========================================================================
describe("editing a deactivated rule", () => {
  knownDefect(
    "UI-RULE-60",
    "editing a deactivated income source (rename only) silently re-activates it",
    async () => {
      // observed: isActive true after saving; the source starts generating income again
      const app = await renderApp({
        route: "/income",
        today: TODAY,
        seed: { incomeSources: [makeIncomeSource({ id: "inc-1", name: "Old Gig", isActive: false })] },
      });
      expect(d.incomeDocs(app)[0].isActive).toBe(false); // precondition
      await d.openEdit(app, "Old Gig");
      await d.next(app);
      await d.fill(app, /^Source Name/, "Old Gig 2");
      await d.saveEdit(app);
      const doc = d.incomeDocs(app)[0];
      expect(doc.name).toBe("Old Gig 2"); // precondition: saved
      expect(doc.isActive).toBe(false);
    }
  );

  knownDefect(
    "UI-RULE-61",
    "editing a deactivated expense rule (rename only) silently re-activates it",
    async () => {
      const app = await renderApp({
        route: "/expenses",
        today: TODAY,
        seed: { expenseRules: [makeExpenseRule({ id: "exp-1", name: "Old Sub", isActive: false })] },
      });
      expect(d.ruleDocs(app)[0].isActive).toBe(false); // precondition
      await d.openEdit(app, "Old Sub");
      await d.next(app);
      await d.fill(app, /^Expense Name/, "Old Sub 2");
      await d.saveEdit(app);
      const doc = d.ruleDocs(app)[0];
      expect(doc.name).toBe("Old Sub 2"); // precondition
      expect(doc.isActive).toBe(false);
    }
  );

  it("the Activate / Deactivate button toggles isActive and stops/starts the projections", async () => {
    const app = await renderApp({
      route: "/income",
      today: TODAY,
      seed: { incomeSources: [makeIncomeSource({ id: "inc-1", name: "Payroll", startDate: "2026-01-20", scheduleConfig: { dayOfMonth: 20 } })] },
    });
    expect(d.engineDates(app, "inc-1").length).toBeGreaterThan(0);
    await app.user.click(screen.getAllByText("Payroll")[0]);
    await app.user.click(screen.getByRole("button", { name: /Deactivate/ }));
    await waitFor(() => expect(d.incomeDocs(app)[0].isActive).toBe(false));
    await app.settle();
    expect(d.engineDates(app, "inc-1")).toEqual([]);
    await app.user.click(await screen.findByRole("button", { name: /Activate/ }));
    await waitFor(() => expect(d.incomeDocs(app)[0].isActive).toBe(true));
    await app.settle();
    expect(d.engineDates(app, "inc-1")).toEqual(["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20"]);
  });
});

// ===========================================================================
describe("editing only the amount", () => {
  it("a monthly expense keeps its schedule and its occurrence overrides; the override still wins in its month", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: {
        expenseRules: [
          makeExpenseRule({
            id: "exp-1",
            name: "Rent",
            amount: 1200,
            startDate: "2026-01-20",
            scheduleConfig: { dayOfMonth: 20 },
            occurrenceOverrides: { "exp-1_2026-02": { amount: 1300 } },
          }),
        ],
      },
    });
    await d.openEdit(app, "Rent");
    await d.next(app);
    await d.fill(app, /^Amount/, "1350");
    await d.saveEdit(app);
    const doc = d.ruleDocs(app)[0];
    expect(doc.amount).toBe(1350);
    expect(doc.startDate).toBe("2026-01-20");
    expect(doc.scheduleConfig).toEqual({ dayOfMonth: 20 });
    expect(doc.occurrenceOverrides).toEqual({ "exp-1_2026-02": { amount: 1300 } });
    const rows = d.engineRows(app, "exp-1");
    expect(rows.map((r) => r.scheduledDate)).toEqual(["2026-01-20", "2026-02-20", "2026-03-20", "2026-04-20"]);
    expect(rows.map((r) => r.projectedAmount)).toEqual([1350, 1300, 1350, 1350]);
  });

  it("a Friday weekly income keeps dayOfWeek 5", async () => {
    const app = await renderApp({
      route: "/income",
      today: TODAY,
      seed: {
        incomeSources: [
          makeIncomeSource({
            id: "inc-1",
            name: "Weekly Gig",
            amount: 100,
            frequency: "weekly",
            startDate: "2026-01-02",
            scheduleConfig: { dayOfWeek: 5 },
            weekendAdjustment: "none",
          }),
        ],
      },
    });
    const before = d.engineDates(app, "inc-1");
    await d.openEdit(app, "Weekly Gig");
    await d.next(app);
    await d.fill(app, /^Amount/, "120");
    await d.saveEdit(app);
    expect(d.incomeDocs(app)[0]).toMatchObject({ amount: 120, scheduleConfig: { dayOfWeek: 5 } });
    expect(d.engineDates(app, "inc-1")).toEqual(before);
  });

  it("a quarterly INCOME source keeps its day and month", async () => {
    const app = await renderApp({
      route: "/income",
      today: TODAY,
      seed: {
        incomeSources: [
          makeIncomeSource({
            id: "inc-1",
            name: "Dividend",
            amount: 300,
            frequency: "quarterly",
            startDate: "2026-01-15",
            scheduleConfig: { dayOfMonth: 15, monthOfYear: 0 },
          }),
        ],
      },
    });
    expect(d.engineDates(app, "inc-1")).toEqual(["2026-01-15", "2026-04-15"]); // precondition
    await d.openEdit(app, "Dividend");
    await d.next(app);
    await d.fill(app, /^Amount/, "310");
    await d.saveEdit(app);
    expect(d.incomeDocs(app)[0].scheduleConfig).toEqual({ dayOfMonth: 15, monthOfYear: 0 });
    expect(d.engineDates(app, "inc-1")).toEqual(["2026-01-15", "2026-04-15"]);
  });

  it(
    "UI-RULE-62 — editing only the amount of a quarterly EXPENSE moves every bill to the 1st (edit wizard rewrites scheduleConfig as {})",
    async () => {
      // seeded with a correct dayOfMonth 15: Jan 15, Apr 15. observed after the edit: engine bills only Apr 1
      const app = await renderApp({
        route: "/expenses",
        today: TODAY,
        seed: {
          expenseRules: [
            makeExpenseRule({
              id: "exp-1",
              name: "Insurance",
              amount: 300,
              frequency: "quarterly",
              startDate: "2026-01-15",
              scheduleConfig: { dayOfMonth: 15 },
            }),
          ],
        },
      });
      expect(d.engineDates(app, "exp-1")).toEqual(["2026-01-15", "2026-04-15"]); // precondition
      await d.openEdit(app, "Insurance");
      await d.next(app);
      await d.fill(app, /^Amount/, "310");
      await d.saveEdit(app);
      expect(d.ruleDocs(app)[0].amount).toBe(310); // precondition: saved
      expect(d.engineDates(app, "exp-1")).toEqual(["2026-01-15", "2026-04-15"]);
    }
  );

  knownDefect(
    "UI-RULE-63",
    "editing only the amount of a weekly rule that has no stored dayOfWeek silently moves it to Sundays",
    async () => {
      // rule created by an older version without a dayOfWeek: start Mon 2026-02-02 -> bills Mondays.
      // the edit wizard defaults the missing dayOfWeek to 0 (Sunday) and saves it: observed first bill Sun Feb 8
      const app = await renderApp({
        route: "/expenses",
        today: TODAY,
        seed: {
          expenseRules: [
            makeExpenseRule({
              id: "exp-1",
              name: "Legacy Weekly",
              amount: 40,
              frequency: "weekly",
              startDate: "2026-02-02",
              scheduleConfig: {},
            }),
          ],
        },
      });
      expect(d.engineDates(app, "exp-1").slice(0, 2)).toEqual(["2026-02-02", "2026-02-09"]); // precondition
      await d.openEdit(app, "Legacy Weekly");
      await d.next(app);
      await d.fill(app, /^Amount/, "45");
      await d.saveEdit(app);
      expect(d.ruleDocs(app)[0].amount).toBe(45); // precondition
      expect(d.engineDates(app, "exp-1").slice(0, 2)).toEqual(["2026-02-02", "2026-02-09"]);
    }
  );

  it("the edit wizard is pre-filled with the saved values (loan balance, name, amount, start date)", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: {
        expenseRules: [
          makeLoanRule(
            { id: "loan-1", name: "Car Loan", startDate: "2026-02-10", scheduleConfig: { dayOfMonth: 10 } },
            { principalAmount: 12_000, currentBalance: 9_000, termMonths: 24, paymentsMade: 5 }
          ),
        ],
      },
    });
    await d.openEdit(app, "Car Loan");
    await d.next(app);
    expect((screen.getByLabelText(/^Loan Name/) as HTMLInputElement).value).toBe("Car Loan");
    expect((screen.getByLabelText(/^Original Principal/) as HTMLInputElement).value).toBe("12000");
    expect((screen.getByLabelText(/^Current Balance/) as HTMLInputElement).value).toBe("9000");
    expect((screen.getByLabelText(/^Term \(Months\)/) as HTMLInputElement).value).toBe("24");
  });
});

// ===========================================================================
describe("editing clears optional values", () => {
  knownDefect(
    "UI-RULE-64",
    "un-ticking 'Set End Date' on an income source does not remove the stored end date",
    async () => {
      // observed: endDate stays 2026-03-01 and the income still stops there
      const app = await renderApp({
        route: "/income",
        today: TODAY,
        seed: {
          incomeSources: [
            makeIncomeSource({
              id: "inc-1",
              name: "Contract",
              startDate: "2026-01-10",
              endDate: "2026-03-01",
              scheduleConfig: { dayOfMonth: 10 },
            }),
          ],
        },
      });
      expect(d.engineDates(app, "inc-1")).toEqual(["2026-01-10", "2026-02-10"]); // precondition
      await d.openEdit(app, "Contract");
      await d.next(app);
      await d.next(app); // schedule step
      await d.check(app, /Set End Date/);
      await d.saveEdit(app);
      const doc = d.incomeDocs(app)[0];
      expect(doc.name).toBe("Contract"); // precondition: saved
      expect(doc.endDate ?? undefined).toBeUndefined();
      expect(d.engineDates(app, "inc-1")).toContain("2026-04-10");
    }
  );

  knownDefect(
    "UI-RULE-65",
    "un-ticking 'Set End Date' on an expense rule does not remove the stored end date",
    async () => {
      const app = await renderApp({
        route: "/expenses",
        today: TODAY,
        seed: {
          expenseRules: [
            makeExpenseRule({
              id: "exp-1",
              name: "Gym",
              startDate: "2026-01-10",
              endDate: "2026-03-01",
              scheduleConfig: { dayOfMonth: 10 },
            }),
          ],
        },
      });
      expect(d.engineDates(app, "exp-1")).toEqual(["2026-01-10", "2026-02-10"]); // precondition
      await d.openEdit(app, "Gym");
      await d.next(app);
      await d.next(app); // schedule step
      await d.check(app, /Set End Date/);
      await d.saveEdit(app);
      const doc = d.ruleDocs(app)[0];
      expect(doc.name).toBe("Gym"); // precondition
      expect(doc.endDate ?? undefined).toBeUndefined();
    }
  );

  knownDefect(
    "UI-RULE-66",
    "clearing the Notes field of an income source keeps the old note",
    async () => {
      const app = await renderApp({
        route: "/income",
        today: TODAY,
        seed: { incomeSources: [makeIncomeSource({ id: "inc-1", name: "Payroll", notes: "old note" })] },
      });
      await d.openEdit(app, "Payroll");
      await d.next(app);
      await d.next(app);
      await d.next(app); // review step
      await d.fill(app, /^Notes/, "");
      await d.saveEdit(app);
      const doc = d.incomeDocs(app)[0];
      expect(doc.name).toBe("Payroll"); // precondition: saved
      expect(doc.notes ?? "").toBe("");
    }
  );
});

// ===========================================================================
describe("changing the frequency of a rule that has history", () => {
  const seed = () => ({
    profile: { currentBalance: 8_800 },
    expenseRules: [
      makeExpenseRule({
        id: "exp-1",
        name: "Rent",
        amount: 1200,
        startDate: "2026-01-10",
        scheduleConfig: { dayOfMonth: 10 },
        occurrenceOverrides: { "exp-1_2026-02": { skipped: true } },
      }),
    ],
    transactions: [
      makeCompletedTransaction({
        id: "txn-jan",
        sourceType: "expense_rule",
        sourceId: "exp-1",
        occurrenceId: "exp-1_2026-01",
        name: "Rent",
        type: "expense",
        projectedAmount: 1200,
        actualAmount: 1200,
        scheduledDate: "2026-01-10",
        actualDate: "2026-01-10",
      }),
    ],
  });

  async function toWeekly() {
    const app = await renderApp({ route: "/expenses", today: TODAY, seed: seed() });
    await d.openEdit(app, "Rent");
    await d.next(app);
    await d.next(app); // schedule step
    await d.pick(app, /^Frequency/, "Weekly");
    await d.pick(app, /^Day of Week/, "Friday");
    await d.saveEdit(app);
    return app;
  }

  it("the completed transaction and the balance already applied are untouched", async () => {
    const app = await toWeekly();
    expect(d.ruleDocs(app)[0]).toMatchObject({ frequency: "weekly", scheduleConfig: { dayOfWeek: 5 } });
    expect(app.store.__all("transactions")).toHaveLength(1);
    expect(app.store.__get<{ status: string }>("transactions", "txn-jan")?.status).toBe("completed");
    expect(app.financial().userProfile?.currentBalance).toBe(8_800);
    const jan = app.financial().transactions.find((t) => t.id === "txn-jan");
    expect(jan).toMatchObject({ status: "completed", actualAmount: 1200 });
  });

  it("the weekly series is generated from the edited schedule (Fridays on/after Jan 10)", async () => {
    const app = await toWeekly();
    const fridays = d.engineDates(app, "exp-1").filter((x) => x !== "2026-01-10");
    expect(fridays.slice(0, 4)).toEqual(["2026-01-16", "2026-01-23", "2026-01-30", "2026-02-06"]);
  });

  it.todo("DECISION: after a frequency change, occurrence overrides (a skipped February) and completed rows keyed by the old occurrenceId no longer match any projection - keep, migrate or discard?");
});

// ===========================================================================
describe("deleting a rule", () => {
  const completed = (overrides = {}) =>
    makeCompletedTransaction({
      id: "txn-jan",
      sourceType: "expense_rule",
      sourceId: "exp-1",
      occurrenceId: "exp-1_2026-01",
      name: "Rent",
      type: "expense",
      projectedAmount: 1200,
      actualAmount: 1250,
      scheduledDate: "2026-01-10",
      actualDate: "2026-01-10",
      ...overrides,
    });

  it("expense rule: removes the rule and its future bills but keeps the completed row and the balance", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: {
        profile: { currentBalance: 8_750 },
        expenseRules: [
          makeExpenseRule({ id: "exp-1", name: "Rent", amount: 1200, startDate: "2026-01-10", scheduleConfig: { dayOfMonth: 10 } }),
        ],
        transactions: [completed()],
      },
    });
    // preconditions: the rule projects future bills and the completed row is part of the merged list
    expect(d.engineDates(app, "exp-1")).toEqual(["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"]);
    await app.user.click(screen.getAllByText("Rent")[0]);
    await app.user.click(screen.getByRole("button", { name: /Delete/ }));
    await app.user.click(await screen.findByRole("button", { name: "Yes, Delete" }));
    await waitFor(() => expect(d.ruleDocs(app)).toHaveLength(0));
    await app.settle();
    // history and money are preserved
    expect(app.store.__all("transactions")).toHaveLength(1);
    expect(app.financial().userProfile?.currentBalance).toBe(8_750);
    const rows = app.financial().transactions.filter((t) => t.sourceId === "exp-1");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "txn-jan", status: "completed", actualAmount: 1250, name: "Rent" });
    expect(screen.getByText("No expenses yet")).toBeInTheDocument();
  });

  it("income source: same - the completed paycheque stays and the balance is unchanged", async () => {
    const app = await renderApp({
      route: "/income",
      today: TODAY,
      seed: {
        profile: { currentBalance: 13_000 },
        incomeSources: [
          makeIncomeSource({ id: "inc-1", name: "Payroll", amount: 3000, startDate: "2026-01-10", scheduleConfig: { dayOfMonth: 10 } }),
        ],
        transactions: [
          makeCompletedTransaction({
            id: "txn-pay",
            sourceType: "income_source",
            sourceId: "inc-1",
            occurrenceId: "inc-1_2026-01",
            name: "Payroll",
            type: "income",
            projectedAmount: 3000,
            actualAmount: 3000,
            scheduledDate: "2026-01-10",
            actualDate: "2026-01-10",
          }),
        ],
      },
    });
    await app.user.click(screen.getAllByText("Payroll")[0]);
    await app.user.click(screen.getByRole("button", { name: /Delete/ }));
    await app.user.click(await screen.findByRole("button", { name: "Yes, Delete" }));
    await waitFor(() => expect(d.incomeDocs(app)).toHaveLength(0));
    await app.settle();
    expect(app.store.__all("transactions")).toHaveLength(1);
    expect(app.financial().userProfile?.currentBalance).toBe(13_000);
    expect(app.financial().transactions.filter((t) => t.sourceId === "inc-1").map((t) => t.status)).toEqual(["completed"]);
  });

  it("'Cancel' on the delete confirmation keeps the rule", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: { expenseRules: [makeExpenseRule({ id: "exp-1", name: "Rent" })] },
    });
    await app.user.click(screen.getAllByText("Rent")[0]);
    await app.user.click(screen.getByRole("button", { name: /Delete/ }));
    await app.user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(d.ruleDocs(app)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
  });
});
