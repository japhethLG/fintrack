import { describe, expect, it, vi } from "vitest";
import {
  renderApp,
  screen,
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

  it("Monthly Recurring / Annual Projection count the real occurrences of each frequency and skip one-time", async () => {
    // REWRITTEN (occurrence counting; the old test pinned the 52/12, 26/12, 2, 1/3, 1/12 multipliers).
    // JANUARY 2026 (today Jan 15): monthly on the 1st = 3,000 ; weekly Fridays Jan 2, 9, 16, 23, 30
    // = 5 x 100 = 500 ; bi-weekly Fridays Jan 2, 16, 30 = 3 x 200 = 600 ; semi-monthly Jan 15 and Jan 30
    // = 2 x 500 = 1,000 ; quarterly Jan 15 = 300 ; yearly (March 5) = 0  ->  5,400.
    // NEXT 12 MONTHS (Jan 15 2026 .. Jan 14 2027): monthly Feb 1 .. Jan 1 = 12 x 3,000 = 36,000 ;
    // weekly Jan 16 .. Jan 8 2027 = 52 x 100 = 5,200 ; bi-weekly Jan 16 every 14 days = 26 x 200 = 5,200 ;
    // semi-monthly Jan 15 .. Dec 30 = 24 x 500 = 12,000 ; quarterly Jan 15, Apr 15, Jul 15, Oct 15
    // = 4 x 300 = 1,200 ; yearly Mar 5 = 1,200  ->  60,800.
    await renderApp({ route: "/income", today: TODAY, seed: { incomeSources: sources() } });
    expect(moneyNear("Monthly Recurring")).toBe(5400);
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
    expect(moneyNear("Monthly Recurring")).toBe(2400); // 5,400 - 3,000 (the January salary)
  });

  it("weekly $100 in a five-Friday month: the Dashboard and the Manager both show the 5 real paydays ($500)", async () => {
    // REWRITTEN (occurrence counting): the manager used to print the 52/12 average, $433
    const seed = { incomeSources: [makeIncomeSource({ id: "i-wk", name: "Weekly Gig", amount: 100, frequency: "weekly" as const, startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5 } })] };
    const inc = await renderApp({ route: "/income", today: TODAY, seed });
    expect(d.engineDates(inc, "i-wk", { from: "2026-01-01", to: "2026-01-31" })).toEqual([
      "2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30",
    ]); // prettier-ignore
    expect(moneyNear("Monthly Recurring")).toBe(500);
    inc.unmount();
    await renderApp({ route: "/dashboard", today: TODAY, seed });
    expect(moneyNear("Total Income")).toBe(500);
  });

  it(
    "UI-RULE-67 — Annual Projection of a daily $10 income is $3,600 (30 x 12) instead of 365 x $10 = $3,650",
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

  it(
    "UI-RULE-68 — an income source whose end date has passed is still counted as Active and in Monthly Recurring",
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

  it("Monthly Recurring counts January's real bills: rent, 4 gym Mondays, the loan EMI and both cards; one-time is separate", async () => {
    // REWRITTEN (occurrence counting; the old test pinned weekly x 52/12 and a 200 installment).
    // JANUARY 2026: rent 1,000 (Jan 1) + gym Mondays Jan 5, 12, 19, 26 = 4 x 25 = 100 + car loan EMI
    // 564.8817 + card A minimum 2% of 5,000 = 100 + card B fixed 300 = 2,064.8817 -> $2,065.
    // The laptop instalment (2 of 6 paid) has its next payment on Mar 1, so January has none.
    await renderApp({ route: "/expenses", today: TODAY, seed: { expenseRules: rules() } });
    expect(moneyNear("Monthly Recurring")).toBe(2064.88); // 2,064.8817
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

  it("weekly $25 in a five-Friday month: the Manager shows the 5 real bills, 5 x $25 = $125 in January", async () => {
    const app = await renderApp({
      route: "/expenses",
      today: TODAY,
      seed: { expenseRules: [makeExpenseRule({ id: "e-gym", name: "Gym", amount: 25, frequency: "weekly", startDate: "2026-01-02", scheduleConfig: { dayOfWeek: 5 } })] },
    });
    expect(d.engineDates(app, "e-gym", { from: "2026-01-01", to: "2026-01-31" })).toEqual([
      "2026-01-02", "2026-01-09", "2026-01-16", "2026-01-23", "2026-01-30",
    ]); // prettier-ignore
    expect(moneyNear("Monthly Recurring")).toBe(125); // REWRITTEN: it printed the 52/12 average, 108
  });

  it(
    "UI-RULE-69 — an expense whose end date has passed is still counted as Active and in Monthly Recurring",
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
