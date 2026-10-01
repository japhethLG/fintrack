/** Brand-new user on every page, and extreme amounts. */
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense, completedTransaction } from "../../index";
import { APP_PAGES, badTokens, isResponsive } from "./support";

test.describe("brand-new user (no profile, no data)", () => {
  for (const p of APP_PAGES) {
    test(`${p.path} renders without errors or NaN`, async ({ page, diagnostics }) => {
      await seedAndLogin(page, { user: null }, { path: p.path });
      await expect(page.getByRole("heading", { name: p.h1, level: 1 })).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      expect(await badTokens(page)).toEqual([]);
      expect(diagnostics.pageErrors).toEqual([]);
    });
  }

  test("an empty account gets a neutral 'Not enough data yet' health card, not a 93/100 'Grade A'", async ({ page }) => {
    // RESOLVED (it was a DECISION marker plus a test pinning "93/100 Grade A + Great cash runway"):
    // with nothing recorded there is nothing to grade.
    await seedAndLogin(page, { user: userProfile({ currentBalance: 0, initialBalance: 0 }) }, { path: "/dashboard" });
    await expect(page.getByText("Not enough data yet")).toBeVisible();
    await expect(page.getByRole("heading", { name: "93/100" })).toHaveCount(0);
    await expect(page.getByText("Grade A")).toHaveCount(0);
    await expect(page.getByText(/Great cash runway/)).toHaveCount(0);
  });

  test("Forecast says 'Not enough data yet' for the runway of an empty zero-balance account, not '90+ days'", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile({ currentBalance: 0, initialBalance: 0 }) }, { path: "/forecast" });
    await expect(page.getByText("Not enough data yet")).toBeVisible();
    await expect(page.getByText("90+ days")).toHaveCount(0);
  });
});

test.describe("extreme numbers", () => {
  test("1e9 income, 0.01 expense and a negative balance render as formatted numbers everywhere", async ({ page, diagnostics }) => {
    test.setTimeout(90_000);
    await seedAndLogin(
      page,
      {
        user: userProfile({ currentBalance: -250.5, initialBalance: -250.5 }),
        incomeSources: [incomeSource({ id: "i1", name: "Windfall", amount: 1e9, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } })],
        expenseRules: [fixedExpense({ id: "e1", name: "Penny", amount: 0.01, startDate: "2026-03-14", scheduleConfig: { dayOfMonth: 14 } })],
        transactions: [completedTransaction({ id: "t1", name: "Tiny", scheduledDate: "2026-03-05", projectedAmount: 0.01, sourceType: "manual" })],
      },
      { path: "/dashboard" }
    );
    await expect(page.getByText("$250.50").first()).toBeVisible(); // negative balance shown with its magnitude
    for (const p of APP_PAGES) {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { name: p.h1, level: 1 })).toBeVisible();
      await expect(page.getByText(/^Loading/)).toHaveCount(0);
      expect(await badTokens(page), p.path).toEqual([]);
      expect(await isResponsive(page, 5_000)).toBe(true);
    }
    await page.goto("/income");
    await expect(page.getByText(/1,000,000,000|1B|1\.0B/).first()).toBeVisible();
    expect(diagnostics.pageErrors).toEqual([]);
  });
});
