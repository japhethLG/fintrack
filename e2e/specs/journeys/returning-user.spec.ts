/**
 * JOURNEY 2 - returning user with 9 months of completed history (6 months BEFORE the
 * default view window Jan 1 2026 .. Jun 30 2026, 3 inside it), today = 2026-03-10.
 *
 *   initialBalance                              2,000
 *   Acme Payroll  monthly 1st  +3,000  completed Jul 2025 .. Mar 2026 (9)  = +27,000
 *   Rent          monthly 5th  -1,200  completed Jul 2025 .. Mar 2026 (9)  = -10,800
 *   signed completed sum = 16,200            => currentBalance = 2,000 + 16,200 = 18,200
 *   pre-window (Jul-Dec 2025) contributes 6 x 1,800 = 10,800; in-window (Jan-Mar 2026) 3 x 1,800 = 5,400.
 * Everything up to today is completed, nothing is overdue, so the balance the
 * user has TODAY is 18,200 on every screen.
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense, completedTransaction, knownDefect } from "../../index";
import * as S from "./support";

const months = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];

const history = (opts: { legacy: boolean; withHistory?: boolean }) => {
  const withHistory = opts.withHistory ?? true;
  const pay = incomeSource({ id: "inc-pay", name: "Acme Payroll", amount: 3000, startDate: "2025-07-01", scheduleConfig: { dayOfMonth: 1 } });
  const rent = fixedExpense({ id: "exp-rent", name: "Rent", amount: 1200, startDate: "2025-07-05", scheduleConfig: { dayOfMonth: 5 } });
  const txns = withHistory
    ? months.flatMap((m) => [
        completedTransaction({ id: `t-pay-${m}`, name: "Acme Payroll", type: "income", sourceType: "income_source", sourceId: "inc-pay", occurrenceId: `inc-pay_${m}`, scheduledDate: `${m}-01`, projectedAmount: 3000 }),
        completedTransaction({ id: `t-rent-${m}`, name: "Rent", type: "expense", sourceType: "expense_rule", sourceId: "exp-rent", occurrenceId: `exp-rent_${m}`, scheduledDate: `${m}-05`, projectedAmount: 1200 }),
      ])
    : [];
  const current = withHistory ? 18_200 : 5_000;
  const base = userProfile({ currentBalance: current, initialBalance: withHistory ? 2_000 : 5_000, preferences: { currency: "USD" } as never });
  const { initialBalance: _drop, ...legacyProfile } = base;
  void _drop;
  return {
    user: (opts.legacy ? legacyProfile : base) as never,
    incomeSources: [pay],
    expenseRules: [rent],
    transactions: txns,
  };
};

test.describe("returning user, 9 months of history", () => {
  test.describe.configure({ timeout: 90_000 });
  test("Dashboard, Forecast and Settings show 18,200 on first login and after reload; history counted as 18 completed", async ({ page }) => {
    await seedAndLogin(page, history({ legacy: false }));
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    for (const round of [1, 2]) {
      const shown = await S.readDisplayedBalances(page);
      expect(S.parseMoney(shown.dashboard), `dashboard round ${round}`).toBe(18_200);
      expect(S.parseMoney(shown.forecast), `forecast round ${round}`).toBe(18_200);
      expect(S.parseMoney(shown.settings), `settings round ${round}`).toBe(18_200);
      expect(shown.settingsComputed).toBe("$18,200.00"); // 2,000 + 27,000 - 10,800
      await expect(page.getByText("Computed from 18 transactions")).toBeVisible();
      await expect(page.getByText(/Balance mismatch detected/)).toHaveCount(0);
      if (round === 1) await page.reload();
    }
    expect((await S.readUser(page)).currentBalance).toBe(18_200);
  });

  test("Calendar closing balance of today is 18,200 (history older than the view window is not lost)", async ({ page }) => {
    knownDefect("E2E-JRN-11", "Calendar Today closing shows $7,400 = 2,000 + only the 3 in-window months; the 6 pre-window months (+10,800) are subtracted from the opening balance and never added back");
    await seedAndLogin(page, history({ legacy: false }), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    expect(S.parseMoney(await S.calendarTodayClosingText(page))).toBe(18_200);
  });

  test("Calendar March opening balance is 16,400 (2,000 + 8 months x 1,800) and stays right after reload", async ({ page }) => {
    knownDefect("E2E-JRN-12", "Monthly Balance Overview opening for Mar 1 shows $5,600 (= 2,000 + Jan + Feb in-window only) instead of $16,400");
    // Mar 1 opening = 2,000 + 6 x 1,800 (2025) + 2 x 1,800 (Jan, Feb 2026) = 16,400
    await seedAndLogin(page, history({ legacy: false }), { path: "/calendar" });
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
    await expect(page.getByText("Opening", { exact: true }).first()).toBeVisible(); // Monthly Balance Overview card
    await expect(page.locator("p.text-2xl.font-bold").first()).toHaveText("$16,400");
  });

  test("legacy profile WITHOUT history: migration sets initialBalance = currentBalance and nothing mismatches", async ({ page }) => {
    await seedAndLogin(page, history({ legacy: true, withHistory: false }), { path: "/settings" });
    await expect(page.getByText("Balance Management")).toBeVisible();
    await expect(page.getByText("Starting Balance (Baseline)").locator("xpath=following-sibling::p").first()).toHaveText("$5,000.00");
    await expect.poll(async () => (await S.readUser(page)).initialBalance).toBe(5_000);
    await expect(page.getByText(/Balance mismatch detected/)).toHaveCount(0);
  });

  test("legacy profile WITH history: migrated initialBalance must be 2,000 (current - sum completed)", async ({ page }) => {
    knownDefect("E2E-JRN-13", "migration copies currentBalance (18,200) into initialBalance; Settings then shows computed $34,400.00 and 'Balance mismatch detected: $16,200.00'");
    await seedAndLogin(page, history({ legacy: true }), { path: "/settings" });
    await expect(page.getByText("Balance Management")).toBeVisible();
    await expect.poll(async () => (await S.readUser(page)).initialBalance).toBeDefined();
    expect((await S.readUser(page)).initialBalance).toBe(2_000);
    await expect(page.getByText(/Balance mismatch detected/)).toHaveCount(0);
  });

  test("'Recalculate Balance' on a legacy profile leaves the real balance at 18,200", async ({ page }) => {
    knownDefect("E2E-JRN-14", "after the wrong migration, Recalculate Balance writes currentBalance = 34,400 (history counted twice)");
    await seedAndLogin(page, history({ legacy: true }), { path: "/settings" });
    await expect(page.getByText("Balance Management")).toBeVisible();
    await expect.poll(async () => (await S.readUser(page)).initialBalance).toBeDefined();
    const recalc = page.getByRole("button", { name: /Recalculate Balance/ });
    // If the migration were right there would be no mismatch and no button; then the balance is trivially unchanged.
    if (await recalc.isVisible()) await recalc.click();
    await expect(page.getByText("Balance updated successfully!").or(page.getByText(/Balance mismatch/)).first()).toBeVisible().catch(() => undefined);
    await expect.poll(async () => (await S.readUser(page)).currentBalance).toBe(18_200);
  });

  test("changing the initial balance with history recalculates current = new initial + 16,200", async ({ page }) => {
    await seedAndLogin(page, history({ legacy: false }), { path: "/settings" });
    await expect(page.getByText("Balance Management")).toBeVisible();
    await page.getByRole("button", { name: /Update Initial Balance/ }).click();
    await page.getByLabel("Set Initial Balance").fill("5000");
    await page.getByRole("button", { name: "Update Initial Balance", exact: true }).click();
    // confirmation dialog quotes the hand-derived figure: 5,000 + 16,200 = 21,200
    await expect(page.getByText("You have 18 completed transactions.", { exact: false })).toBeVisible();
    await expect(page.getByText("New computed balance:").locator("xpath=following-sibling::span")).toHaveText("$21,200.00");
    await page.getByRole("button", { name: "Update & Recalculate" }).click();
    await expect.poll(async () => (await S.readUser(page)).currentBalance).toBe(21_200);
    expect((await S.readUser(page)).initialBalance).toBe(5_000);
    await S.gotoPage(page, "Dashboard");
    expect(await S.dashboardBalanceText(page)).toBe("$21,200.00");
  });
});
