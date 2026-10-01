import { describe, expect, it, vi } from "vitest";
import {
  makeCompletedTransaction,
  makeExpenseRule,
  makeIncomeSource,
  type AppSeed,
} from "../harness";
import { card, money, renderPages, stat, within } from "./screens";

// Load-tolerant: a cold first render can exceed the default 20s on a busy machine.
vi.setConfig({ testTimeout: 90_000 });

/**
 * ONE HOUSEHOLD, EVERY SCREEN: the same month's income, expenses and net, and the same balance, on
 * the Dashboard, the Calendar, the Forecast and both managers.
 *
 * H3 "Santos": today Mon 2026-03-16, the month under test is March 2026. Every row comes from a
 * rule, so the managers' recurring totals are the month's totals too. All values hand-derived.
 *
 *   initial balance 4,000
 *   Salary     monthly on the 1st, 3,000 (start 2026-03-01)   Mar 1 COMPLETED
 *   Freelance  monthly on the 20th, 500 (start 2026-03-20)    Mar 20 projected
 *   Rent       monthly on the 1st, 1,200 (start 2026-03-01)    Mar 1 COMPLETED
 *   Internet   monthly on the 25th, 60 (start 2026-03-25)      Mar 25 projected
 *   Groceries  weekly on Saturday, 100 (start 2026-03-07)      Mar 7 and Mar 14 COMPLETED,
 *                                                              Mar 21 and Mar 28 projected
 *
 *   MARCH   income   = 3,000 + 500                      = 3,500
 *           expenses = 1,200 + 60 + 4 x 100             = 1,660
 *           net      = 3,500 - 1,660                    = 1,840   (savings rate 1,840 / 3,500 = 52.6%)
 *   BALANCE currentBalance = 4,000 + 3,000 - 1,200 - 100 - 100 = 5,600
 *           March opens at 5,600 - (completed on/after Mar 1 = 3,000 - 1,200 - 200 = 1,600) = 4,000
 *           today (Mar 16): nothing due, nothing overdue  => opening 5,600, closing 5,600 (= balance)
 *           March closes at 4,000 + 1,840 = 5,840
 *   NEXT 12 MONTHS (Mar 16 2026 .. Mar 15 2027), recurring income:
 *           salary Apr 1 .. Mar 1 = 12 x 3,000 = 36,000 ; freelance Mar 20 .. Feb 20 = 12 x 500 = 6,000
 */

const H3_TODAY = "2026-03-16";

const done = (
  o: Parameters<typeof makeCompletedTransaction>[0] & { sourceId: string; occurrenceId: string }
) => makeCompletedTransaction(o);

const h3Seed = (): AppSeed => ({
  profile: { currentBalance: 5_600, initialBalance: 4_000, balanceLastUpdatedAt: "2026-03-14" },
  incomeSources: [
    makeIncomeSource({ id: "sal", name: "Salary", amount: 3_000, frequency: "monthly", startDate: "2026-03-01", scheduleConfig: { dayOfMonth: 1 } }),
    makeIncomeSource({ id: "free", name: "Freelance", sourceType: "freelance", category: "freelance", amount: 500, isVariableAmount: true, frequency: "monthly", startDate: "2026-03-20", scheduleConfig: { dayOfMonth: 20 } }),
  ],
  expenseRules: [
    makeExpenseRule({ id: "rent", name: "Rent", amount: 1_200, frequency: "monthly", startDate: "2026-03-01", scheduleConfig: { dayOfMonth: 1 } }),
    makeExpenseRule({ id: "net", name: "Internet", category: "utilities", amount: 60, frequency: "monthly", startDate: "2026-03-25", scheduleConfig: { dayOfMonth: 25 } }),
    makeExpenseRule({ id: "groc", name: "Groceries", category: "groceries", amount: 100, frequency: "weekly", startDate: "2026-03-07", scheduleConfig: { dayOfWeek: 6 } }),
  ],
  transactions: [
    done({ id: "t-sal", sourceType: "income_source", sourceId: "sal", occurrenceId: "sal_2026-03", name: "Salary", type: "income", category: "salary", projectedAmount: 3_000, scheduledDate: "2026-03-01" }),
    done({ id: "t-rent", sourceType: "expense_rule", sourceId: "rent", occurrenceId: "rent_2026-03", name: "Rent", type: "expense", category: "housing", projectedAmount: 1_200, scheduledDate: "2026-03-01" }),
    done({ id: "t-g1", sourceType: "expense_rule", sourceId: "groc", occurrenceId: "groc_2026-W10", name: "Groceries", type: "expense", category: "food", projectedAmount: 100, scheduledDate: "2026-03-07" }),
    done({ id: "t-g2", sourceType: "expense_rule", sourceId: "groc", occurrenceId: "groc_2026-W11", name: "Groceries", type: "expense", category: "food", projectedAmount: 100, scheduledDate: "2026-03-14" }),
  ],
});

const mount = () =>
  renderPages(["dashboard", "calendar", "forecast", "income", "expenses"], {
    today: H3_TODAY,
    timeZone: "UTC",
    seed: h3Seed(),
  });

describe("one household, every screen (H3, March 2026)", () => {
  it("the same month: income 3,500, expenses 1,660, net 1,840 on the Dashboard, Calendar and Forecast", async () => {
    const { app, page } = await mount();
    // preconditions: the household loaded as designed
    expect(app.financial().userProfile?.currentBalance).toBe(5_600);
    expect(app.store.__count("transactions")).toBe(4);
    expect(app.financial().ledger).toMatchObject({ completedCount: 4, sum: 1_600 }); // 3,000 - 1,200 - 100 - 100

    const kpi = card(page("dashboard"), "Period Summary");
    expect(money(kpi, "Total Income")).toBe(3_500);
    expect(money(kpi, "Total Expenses")).toBe(-1_660);
    expect(money(kpi, "Net Flow")).toBe(1_840);

    const cal = page("calendar");
    expect(money(cal, "Income", { occurrence: 0 })).toBe(3_500);
    expect(money(cal, "Expenses", { occurrence: 0 })).toBe(-1_660);
    expect(money(cal, "Net Change", { occurrence: 0 })).toBe(1_840);

    const fc = card(page("forecast"), /Budgeted vs Actual/);
    expect(money(fc, "Actual", { occurrence: 0 })).toBe(3_500);
    expect(money(fc, "Actual", { occurrence: 1 })).toBe(1_660);
    expect(money(fc, "Actual", { occurrence: 2 })).toBe(1_840);
    // every row met its plan, so the plan is the same figures (no prorated phantom variance)
    expect(money(fc, "Budgeted", { occurrence: 0 })).toBe(3_500);
    expect(money(fc, "Budgeted", { occurrence: 1 })).toBe(1_660);
    expect(money(fc, "Budgeted", { occurrence: 2 })).toBe(1_840);
    expect(within(page("forecast")).getAllByText("52.6%").length).toBeGreaterThanOrEqual(1);
  });

  it("the managers count the same March occurrences", async () => {
    const { page } = await mount();

    expect(money(page("income"), "Monthly Recurring")).toBe(3_500);
    expect(money(page("expenses"), "Monthly Recurring")).toBe(1_660);
    expect(money(card(page("dashboard"), "Recurring Summary"), "Monthly Income")).toBe(3_500);
    expect(money(card(page("dashboard"), "Recurring Summary"), "Monthly Expenses")).toBe(1_660);
    expect(money(card(page("dashboard"), "Recurring Summary"), "Net Recurring")).toBe(1_840);
    expect(money(page("income"), "Annual Projection")).toBe(42_000); // 36,000 + 6,000
    expect(stat(page("income"), "Active Sources")).toBe("2");
    expect(stat(page("expenses"), "Active Expenses")).toBe("3");
  });

  it("today's balance is the realized 5,600 on the Dashboard, the Forecast and the Calendar", async () => {
    const { app, page } = await mount();

    expect(money(card(page("dashboard"), "Period Summary"), "Current Balance")).toBe(5_600);
    expect(money(page("forecast"), "Current Balance")).toBe(5_600);

    const cal = page("calendar");
    await app.user.click(within(cal).getByRole("button", { name: "Today" }));
    const today = card(cal, "Monday, Mar 16");
    expect(money(today, "Opening")).toBe(5_600);
    expect(money(today, "Closing")).toBe(5_600);
  });

  it("the month opens at 4,000 and closes at 5,840 on the Calendar and the Dashboard cash-flow card", async () => {
    const { page } = await mount();

    expect(money(page("calendar"), "Opening", { occurrence: 0 })).toBe(4_000);
    expect(money(page("calendar"), "Closing", { occurrence: 0 })).toBe(5_840);
    const chart = card(page("dashboard"), /Projected Cash Flow/);
    expect(money(chart, "Opening")).toBe(4_000);
    expect(money(chart, "Closing")).toBe(5_840);
    // and the change on the card is the month's net: 5,840 - 4,000 = +1,840
    expect(chart.textContent).toContain("1,840");
  });

  it("the calendar's numbers do not depend on how far it has been scrolled", async () => {
    const { app, page } = await mount();
    const cal = page("calendar");
    const before = money(cal, "Closing", { occurrence: 0 });

    const prev = within(cal).getByText("chevron_left").closest("button")!;
    const next = within(cal).getByText("chevron_right").closest("button")!;
    for (let i = 0; i < 5; i += 1) await app.user.click(prev);
    for (let i = 0; i < 5; i += 1) await app.user.click(next);

    expect(within(cal).getByText("March 2026")).toBeInTheDocument();
    expect(money(cal, "Closing", { occurrence: 0 })).toBe(before);
    expect(money(cal, "Opening", { occurrence: 0 })).toBe(4_000);
  });
});
