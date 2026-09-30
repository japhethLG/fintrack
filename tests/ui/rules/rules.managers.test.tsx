import { describe, expect, it, vi } from "vitest";
import {
  renderApp,
  screen,
  knownDefect,
  moneyNear,
  makeIncomeSource,
  makeExpenseRule,
  makeLoanRule,
  makeCreditRule,
  makeInstallmentRule,
} from "../harness";
import * as d from "./driver";

// Cold first render (antd + radix + wizard) can exceed the 20 s default on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

/**
 * IncomeManager / ExpenseManager summary cards and detail cards versus what the engine really generates.
 * 2026: Fridays in January are 2, 9, 16, 23, 30 (five); in February 6, 13, 20, 27 (four).
 */

const TODAY = "2026-01-15";

const cardValue = (label: string) => screen.getByText(label).nextElementSibling!.textContent;

// ===========================================================================
describe("IncomeManager summary cards", () => {
  const sources = () => [
    makeIncomeSource({ id: "i-mon", name: "Salary", amount: 3000, frequency: "monthly", startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } }),
    makeIncomeSource({ id: "i-wk", name: "Weekly Gig", amount: 100, frequency: "weekly", startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5 } }),
    makeIncomeSource({ id: "i-bw", name: "Bi-weekly Gig", amount: 200, frequency: "bi-weekly", startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5, intervalWeeks: 2 } }),
    makeIncomeSource({ id: "i-sm", name: "Semi Pay", amount: 500, frequency: "semi-monthly", startDate: "2026-01-01", scheduleConfig: { specificDays: [15, 30] } }),
    makeIncomeSource({ id: "i-q", name: "Dividend", amount: 300, frequency: "quarterly", startDate: "2026-01-15", scheduleConfig: { dayOfMonth: 15 } }),
    makeIncomeSource({ id: "i-y", name: "Bonus", amount: 1200, frequency: "yearly", startDate: "2026-03-05", scheduleConfig: { dayOfMonth: 5, monthOfYear: 2 } }),
    makeIncomeSource({ id: "i-1", name: "Tax Refund", amount: 500, frequency: "one-time", startDate: "2026-02-10" }),
  ];

  it("Monthly Recurring / Annual Projection normalise each frequency (52/12, 26/12, 2, 1/3, 1/12) and skip one-time", async () => {
    // monthly 3000 + weekly 100*52/12 (433.33) + bi-weekly 200*26/12 (433.33) + semi 500*2 (1000)
    //   + quarterly 300/3 (100) + yearly 1200/12 (100) = 5066.67 -> "$5,067"; x12 = 60,800
    await renderApp({ route: "/income", today: TODAY, seed: { incomeSources: sources() } });
    expect(moneyNear("Monthly Recurring")).toBe(5067);
    expect(moneyNear("Annual Projection")).toBe(60_800);
    expect(moneyNear("One-time Income")).toBe(500);
    expect(cardValue("Active Sources")).toBe("7");
  });

  it("the totals follow the Deactivate button", async () => {
    const app = await renderApp({ route: "/income", today: TODAY, seed: { incomeSources: sources() } });
    await app.user.click(screen.getAllByText("Salary")[0]);
    await app.user.click(screen.getByRole("button", { name: /Deactivate/ }));
    await screen.findByText("Inactive", { selector: "span" }).catch(() => undefined);
    await app.settle();
    expect(cardValue("Active Sources")).toBe("6");
    expect(moneyNear("Monthly Recurring")).toBe(2067); // 5066.67 - 3000
  });

  it("weekly $100 in a five-Friday month: the Dashboard shows the 5 real paydays ($500) while the Manager's Monthly Recurring is the 52/12 average ($433)", async () => {
    // documents both definitions; see the DECISION below
    const seed = { incomeSources: [makeIncomeSource({ id: "i-wk", name: "Weekly Gig", amount: 100, frequency: "weekly" as const, startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5 } })] };
    const inc = await renderApp({ route: "/income", today: TODAY, seed });
    expect(d.engineDates(inc, "i-wk", { from: "2026-01-01", to: "2026-01-31" })).toEqual([
      "2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30",
    ]); // prettier-ignore
    expect(moneyNear("Monthly Recurring")).toBe(433);
    inc.unmount();
    await renderApp({ route: "/dashboard", today: TODAY, seed });
    expect(moneyNear("Total Income")).toBe(500);
  });

  it.todo("DECISION: Manager 'Monthly Recurring' is a 52/12 average; the Dashboard/Calendar show actual occurrences per month (5 vs 4 Fridays). Keep both definitions or reconcile?");

  knownDefect(
    "UI-RULE-67",
    "Annual Projection of a daily $10 income is $3,600 (30 x 12) instead of 365 x $10 = $3,650",
    async () => {
      // observed: Monthly Recurring $300 (x30) and Annual Projection $3,600
      await renderApp({
        route: "/income",
        today: TODAY,
        seed: { incomeSources: [makeIncomeSource({ id: "i-d", name: "Daily", amount: 10, frequency: "daily", startDate: "2026-01-01" })] },
      });
      expect(moneyNear("Monthly Recurring")).toBeGreaterThan(0); // precondition: the source is counted
      expect(moneyNear("Annual Projection")).toBe(3650);
    }
  );

  knownDefect(
    "UI-RULE-68",
    "an income source whose end date has passed is still counted as Active and in Monthly Recurring",
    async () => {
      // ended 2025-12-31, isActive true: no future income is generated, yet Monthly Recurring shows $3,000
      const app = await renderApp({
        route: "/income",
        today: TODAY,
        seed: {
          incomeSources: [
            makeIncomeSource({ id: "i-old", name: "Old Contract", amount: 3000, startDate: "2025-06-01", endDate: "2025-12-31", scheduleConfig: { dayOfMonth: 1 } }),
          ],
        },
      });
      expect(screen.getAllByText("Old Contract").length).toBeGreaterThan(0); // precondition
      expect(d.engineDates(app, "i-old", { from: "2026-01-01", to: "2026-04-28" })).toEqual([]); // nothing more will arrive
      expect(moneyNear("Monthly Recurring")).toBe(0);
    }
  );
});

// ===========================================================================
describe("ExpenseManager summary cards", () => {
  const rules = () => [
    makeExpenseRule({ id: "e-rent", name: "Rent", amount: 1000, isPriority: true, startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } }),
    makeExpenseRule({ id: "e-gym", name: "Gym", amount: 25, frequency: "weekly", startDate: "2026-01-05", scheduleConfig: { dayOfWeek: 1 } }),
    makeExpenseRule({ id: "e-fee", name: "Registration", amount: 400, frequency: "one-time", expenseType: "one-time", startDate: "2026-02-10" }),
    makeLoanRule({ id: "e-loan", name: "Car Loan", amount: 565 }, { currentBalance: 6000, termMonths: 24 }),
    makeCreditRule({ id: "e-cardA", name: "Card A", amount: 100 }, { currentBalance: 5000 }),
    makeCreditRule({ id: "e-cardB", name: "Card B", amount: 100 }, { currentBalance: 3000, paymentStrategy: "fixed", fixedPaymentAmount: 300 }),
    makeInstallmentRule({ id: "e-inst", name: "Laptop", amount: 200 }, { installmentCount: 6, installmentsPaid: 2, installmentAmount: 200 }),
  ];

  it("Monthly Recurring uses the loan EMI, the card's fixed payment and 52/12 for weekly; one-time is separate", async () => {
    // 1000 + 25*52/12 (108.33) + 565 + 100 (card A amount) + 300 (card B fixed) + 200 = 2273.33 -> $2,273
    await renderApp({ route: "/expenses", today: TODAY, seed: { expenseRules: rules() } });
    expect(moneyNear("Monthly Recurring")).toBe(2273);
    expect(moneyNear("One-time")).toBe(400);
    expect(cardValue("Active Expenses")).toBe("7");
    expect(cardValue("Priority Bills")).toBe("1");
  });

  it("Total Debt = loan balance + card balances + unpaid instalments (6000 + 5000 + 3000 + 4 x 200)", async () => {
    await renderApp({ route: "/expenses", today: TODAY, seed: { expenseRules: rules() } });
    expect(moneyNear("Total Debt")).toBe(14_800);
  });

  it("a card on 'Pay Full Balance' is counted at its whole balance every month", async () => {
    await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: { expenseRules: [makeCreditRule({ id: "c", name: "Card", amount: 50 }, { currentBalance: 2500, paymentStrategy: "full_balance" })] },
    });
    expect(moneyNear("Monthly Recurring")).toBe(2500);
  });

  it("weekly $25 in a five-Friday month: the Manager shows the 52/12 average ($108) while the engine bills 5 x $25 = $125 in January", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: { expenseRules: [makeExpenseRule({ id: "e-gym", name: "Gym", amount: 25, frequency: "weekly", startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5 } })] },
    });
    expect(d.engineDates(app, "e-gym", { from: "2026-01-01", to: "2026-01-31" })).toEqual([
      "2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30",
    ]); // prettier-ignore
    expect(moneyNear("Monthly Recurring")).toBe(108); // 25 * 52 / 12 = 108.33
  });

  knownDefect(
    "UI-RULE-69",
    "an expense whose end date has passed is still counted as Active and in Monthly Recurring",
    async () => {
      const app = await renderApp({
        route: "/expenses",
        today: TODAY,
        seed: {
          expenseRules: [
            makeExpenseRule({ id: "e-old", name: "Old Gym", amount: 50, startDate: "2025-06-01", endDate: "2025-12-31", scheduleConfig: { dayOfMonth: 1 } }),
          ],
        },
      });
      expect(screen.getAllByText("Old Gym").length).toBeGreaterThan(0); // precondition
      expect(d.engineDates(app, "e-old", { from: "2026-01-01", to: "2026-04-28" })).toEqual([]);
      expect(moneyNear("Monthly Recurring")).toBe(0);
    }
  );
});

// ===========================================================================
describe("detail cards describe the schedule the engine will follow", () => {
  it("income: weekly 'Every Friday', bi-weekly 'Every 2 weeks on Friday', semi-monthly '1st and 15th', monthly '31st'", async () => {
    const app = await renderApp({
      route: "/income",
      today: TODAY,
      seed: {
        incomeSources: [
          makeIncomeSource({ id: "a", name: "A Weekly", frequency: "weekly", scheduleConfig: { dayOfWeek: 5 } }),
          makeIncomeSource({ id: "b", name: "B Biweekly", frequency: "bi-weekly", scheduleConfig: { dayOfWeek: 5, intervalWeeks: 2 } }),
          makeIncomeSource({ id: "c", name: "C Semi", frequency: "semi-monthly", scheduleConfig: { specificDays: [1, 15] } }),
          makeIncomeSource({ id: "e", name: "E Monthly", frequency: "monthly", scheduleConfig: { dayOfMonth: 31 } }),
        ],
      },
    });
    const expected: Record<string, string> = {
      "A Weekly": "Every Friday",
      "B Biweekly": "Every 2 weeks on Friday",
      "C Semi": "On the 1st and 15th of each month",
      "E Monthly": "On the 31st of each month",
    };
    for (const [name, text] of Object.entries(expected)) {
      await app.user.click(screen.getAllByText(name)[0]);
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
  });

  it("ordinals: 2nd, 3rd, 11th, 12th, 13th, 21st, 22nd, 23rd in the semi-monthly description", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: {
        expenseRules: [
          makeExpenseRule({ id: "a", name: "Odd Days", frequency: "semi-monthly", scheduleConfig: { specificDays: [2, 3, 11, 12, 13, 21, 22, 23] } }),
        ],
      },
    });
    await app.user.click(screen.getAllByText("Odd Days")[0]);
    expect(
      await screen.findByText("On the 2nd and 3rd and 11th and 12th and 13th and 21st and 22nd and 23rd of each month")
    ).toBeInTheDocument();
  });
});
