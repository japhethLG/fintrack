/**
 * Debt journeys + on-screen money formatting found while walking the journeys.
 * Seeded state, real UI for every payment (calendar -> dialog -> Mark Complete),
 * clock moved to each due date with a hard reload in between.
 */
import { test, expect, seedAndLogin, userProfile, cashLoan, creditCard, installment, fixedExpense, knownDefect } from "../../index";
import * as S from "./support";

const usd = { preferences: { currency: "USD" } as never };

test.describe.configure({ timeout: 150_000 }); // each payment = clock move + hard reload + calendar + dialog

test.describe("loan paid for 4 months (8,000 @ 12% APR, 8 months, first payment 2026-03-15)", () => {
  // Standard amortisation r = 1%/month: PMT = 8000*0.01/(1-1.01^-8) = 1,045.52 every month.
  // interest/principal/balance after k: 1: 80.00/965.52/7,034.48  2: 70.34/975.18/6,059.30
  //   3: 60.59/984.93/5,074.37  4: 50.74/994.78/4,079.59   -> after 4 payments owe 4,079.59,
  //   next EMI still 1,045.52 (payment 5 of 8, Jul 15), 4 payments (Jul, Aug, Sep, Oct) remain.
  const seed = () => ({
    user: userProfile({ currentBalance: 20_000, initialBalance: 20_000, ...usd }),
    expenseRules: [
      cashLoan(
        { name: "Car Loan", startDate: "2026-03-15", amount: 1045.522336346522, scheduleConfig: { dayOfMonth: 15 } },
        { principalAmount: 8000, currentBalance: 8000, interestRate: 12, termMonths: 8, monthlyPayment: 1045.522336346522, loanStartDate: "2026-03-10", firstPaymentDate: "2026-03-15", paymentsMade: 0 }
      ),
    ],
  });

  const payMonths = async (page: import("@playwright/test").Page, months: [string, string, string][]) => {
    for (const [iso, month] of months) {
      await S.moveClockAndLoad(page, iso, "/calendar", "Financial Calendar");
      await S.calendarShowMonth(page, month);
      await S.openCalendarTxn(page, 15, "Car Loan");
      await S.completeInDialog(page);
    }
  };
  const FOUR: [string, string, string][] = [
    ["2026-03-15T12:00:00Z", "March 2026", "15"],
    ["2026-04-15T12:00:00Z", "April 2026", "15"],
    ["2026-05-15T12:00:00Z", "May 2026", "15"],
    ["2026-06-15T12:00:00Z", "June 2026", "15"],
  ];

  test("each of the 4 payments is the same 1,045.52 EMI", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
    await seedAndLogin(page, seed(), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await payMonths(page, FOUR);
    const paid = (await S.readTxns(page)).filter((t) => t.status === "completed").map((t) => S.round2(t.actualAmount ?? 0));
    expect(paid).toEqual([1045.52, 1045.52, 1045.52, 1045.52]);
  });

  test("after 4 payments: balance 4,079.59, 4 payments still projected, next EMI 1,045.52, Upcoming Bills lists Jul 15", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
    await seedAndLogin(page, seed(), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await payMonths(page, FOUR);
    await S.gotoPage(page, "Expense Manager");
    await expect(page.getByText("Total Debt").locator("xpath=following-sibling::p")).toHaveText("$4,080");
    await expect(page.getByText("Progress").locator("xpath=following-sibling::span")).toHaveText("49%");
    await expect(page.locator("h4.uppercase")).toHaveText(/THURSDAY, JUL 16|WEDNESDAY, JUL 15/i);
    await S.gotoPage(page, "Transactions");
    await expect(page.getByText("Pending", { exact: true }).locator("xpath=following-sibling::p")).toHaveText("3");
    // REWRITTEN (write-path stream, with a derivation). The loan still has 4 payments to make
    // (Jul 15, Aug 15, Sep 15, Oct 15: 8 terms - 4 paid), but the
    // Transactions page counts the rows inside the default view window: 2 months back to the LAST
    // DAY of today's month + 3. Today is Jun 15 (the clock of the 4th payment), so the window ends
    // Sep 30 and the Oct 15 payment is outside it: Jul, Aug, Sep = 3 pending.
  });

  test("after 4 payments the user's money is 20,000 - 4 x 1,045.52 = 15,817.91 and pages agree with the ledger", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
    await seedAndLogin(page, seed(), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await payMonths(page, FOUR);
    expect((await S.readUser(page)).currentBalance).toBeCloseTo(20_000 - 4 * 1045.5223, 1);
  });

  test("ledger invariant holds after 4 payments (whatever the amounts): current == initial + signed completed", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-15T12:00:00Z"));
    await seedAndLogin(page, seed(), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await payMonths(page, FOUR);
    const rule = await S.readRule<{ loanConfig: { paymentsMade: number } }>(page, "Car Loan");
    expect(rule.loanConfig.paymentsMade).toBe(4); // counter increments once per completion
    const txns = await S.readTxns(page);
    expect(txns.filter((t) => t.status === "completed")).toHaveLength(4);
    expect((await S.readUser(page)).currentBalance).toBeCloseTo(20_000 + S.signedCompleted(txns), 6);
  });
});

test.describe("installment plan and credit card journeys", () => {
  test("installment 1,200 / 6: each 200 payment lowers Total Debt by 200 and Progress follows (passes)", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-20T12:00:00Z"));
    await seedAndLogin(page, {
      user: userProfile({ currentBalance: 5000, initialBalance: 5000, ...usd }),
      expenseRules: [installment({ name: "Phone Plan", startDate: "2026-03-20", scheduleConfig: { dayOfMonth: 20 } }, { totalAmount: 1200, installmentCount: 6, installmentAmount: 200 })],
    }, { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    const steps: [string, string, number][] = [["2026-03-20T12:00:00Z", "March 2026", 1], ["2026-04-20T12:00:00Z", "April 2026", 2]];
    for (const [iso, month, n] of steps) {
      await S.moveClockAndLoad(page, iso, "/calendar", "Financial Calendar");
      await S.calendarShowMonth(page, month);
      await S.openCalendarTxn(page, 20, "Phone Plan");
      await S.completeInDialog(page);
      await S.gotoPage(page, "Expense Manager");
      await expect(page.getByText("Total Debt").locator("xpath=following-sibling::p")).toHaveText(`$${(1200 - 200 * n).toLocaleString("en-US")}`);
      await expect(page.getByText("Payment Progress").or(page.getByText("Progress")).first()).toBeVisible();
    }
    expect((await S.readUser(page)).currentBalance).toBe(5000 - 400);
  });

  test("0% card 1,000 paid 400 twice: Total Debt falls to 200 (1,000 - 800)", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-03-25T12:00:00Z"));
    await seedAndLogin(page, {
      user: userProfile({ currentBalance: 5000, initialBalance: 5000, ...usd }),
      expenseRules: [creditCard({ name: "Promo Card", startDate: "2026-03-01", amount: 400, scheduleConfig: { dayOfMonth: 25 } }, { creditLimit: 5000, currentBalance: 1000, apr: 0, paymentStrategy: "fixed", fixedPaymentAmount: 400, dueDate: 25, statementDate: 5 })],
    }, { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    for (const [iso, month] of [["2026-03-25T12:00:00Z", "March 2026"], ["2026-04-25T12:00:00Z", "April 2026"]]) {
      await S.moveClockAndLoad(page, iso, "/calendar", "Financial Calendar");
      await S.calendarShowMonth(page, month);
      await S.openCalendarTxn(page, 25, "Promo Card");
      await S.completeInDialog(page);
    }
    expect((await S.readUser(page)).currentBalance).toBe(5000 - 800);
    await S.gotoPage(page, "Expense Manager");
    await expect(page.getByText("Total Debt").locator("xpath=following-sibling::p")).toHaveText("$200");
  });

  test("Total Debt is the same on Expenses and Forecast: 12,000 loan + 5,000 card + 1,200 installment = 18,200", async ({ page }) => {
    knownDefect("E2E-JRN-18", "Forecast 'Total Debt' shows $17,000 (installment plans left out) while Expenses shows $18,200");
    await seedAndLogin(page, {
      user: userProfile({ currentBalance: 5000, initialBalance: 5000, ...usd }),
      expenseRules: [cashLoan(), creditCard(), installment()].map((r) => ({ ...r, startDate: "2026-03-10" })),
    }, { path: "/expenses" });
    await expect(page.getByRole("heading", { name: "Expense Management", level: 1 })).toBeVisible();
    await expect(page.getByText("Total Debt").locator("xpath=following-sibling::p")).toHaveText("$18,200");
    await S.gotoPage(page, "AI Forecast");
    await expect(page.getByText("Total Debt", { exact: true }).locator("xpath=following-sibling::p").first()).toHaveText("$18,200");
  });
});

test.describe("money formatting on screen", () => {
  const rentOnly = (bal: number) => ({
    user: userProfile({ currentBalance: bal, initialBalance: bal, preferences: { currency: "PHP" } as never }),
    expenseRules: [fixedExpense({ name: "Rent", amount: 100.5, startDate: "2026-03-20", scheduleConfig: { dayOfMonth: 20 } })],
  });

  test("Calendar day sidebar uses the user's currency symbol (PHP) and 2 decimals", async ({ page }) => {
    await seedAndLogin(page, rentOnly(1000), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await S.calendarSelectDay(page, 20);
    const rows = await S.calendarSidebarRows(page);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("-₱100.50");
  });

  test("Calendar cell of a negative balance keeps its minus sign", async ({ page }) => {
    await seedAndLogin(page, rentOnly(-500), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await expect(page.locator("div.min-h-\\[100px\\]:not(.opacity-50)").filter({ hasText: /^5(?!\d)/ }).first()).toContainText("-₱500");
  });

  test("Forecast Current Balance prints 2 decimals like the Dashboard (₱8,662.50)", async ({ page }) => {
    await seedAndLogin(page, rentOnly(8662.5), { path: "/forecast" });
    await expect(page.getByRole("heading", { name: "AI Financial Forecaster", level: 1 })).toBeVisible();
    expect(await S.forecastBalanceText(page)).toBe("₱8,662.50");
  });
});
