/**
 * Calendar layout: a phone (MANUAL-M4) and amounts next to their sign (calendar cosmetics).
 * Fixture: today Tue 2026-03-10. A large balance and large amounts make every figure as wide as it gets.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense } from "../../index";
import { gridCells, monthCell, selectDay, sidebar, viewedHeading } from "./_support";

const seed = {
  user: userProfile({ currentBalance: 1_234_567.89, initialBalance: 1_234_567.89 }),
  incomeSources: [
    incomeSource({ id: "pay", name: "Payroll With A Long Name", amount: 123_456.78, frequency: "monthly", startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
  ],
  expenseRules: [
    fixedExpense({ id: "rent", name: "Rent And Utilities", amount: 98_765.43, frequency: "monthly", startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
  ],
};

const boot = async (page: Page, data = seed) => {
  await seedAndLogin(page, data, { path: "/calendar" });
  await expect(viewedHeading(page)).toHaveText("March 2026");
};

/** Every element inside `cell` whose box sticks out of the cell's own box (px tolerance 1). */
const spillsOutOfCell = (cell: Locator) =>
  cell.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll("*"))
      .map((child) => ({ child, r: child.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1))
      .map(({ child, r }) => `${child.tagName} "${(child.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)}`);
  });

test.describe("phone (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("month grid: no day's balance or chip spills into its neighbour, and the page does not scroll sideways", async ({ page }) => {
    await boot(page);
    await expect(monthCell(page, "2026-03", "2026-03-13").getByText("Payroll With A Long Name")).toBeVisible();
    const cells = gridCells(page);
    expect(await cells.count()).toBe(42);
    const problems: string[] = [];
    for (let i = 0; i < 42; i++) {
      for (const p of await spillsOutOfCell(cells.nth(i))) problems.push(`cell ${i}: ${p}`);
    }
    expect(problems).toEqual([]);
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(o.sw).toBeLessThanOrEqual(o.iw);
  });

  test("month grid: a balance is still readable (compact amount, full amount on hover)", async ({ page }) => {
    await boot(page);
    const balance = monthCell(page, "2026-03", "2026-03-11").locator("span[title]");
    await expect(balance).toHaveText("$1.2M");
    await expect(balance).toHaveAttribute("title", "$1,234,567.89");
  });

  test("week view: nothing spills out of a day either", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    const cells = gridCells(page);
    expect(await cells.count()).toBe(7);
    const problems: string[] = [];
    for (let i = 0; i < 7; i++) {
      for (const p of await spillsOutOfCell(cells.nth(i))) problems.push(`cell ${i}: ${p}`);
    }
    expect(problems).toEqual([]);
  });
});

test.describe("desktop: a sign stays on the line of its amount", () => {
  // The audit's figures (12 Oct: Income +12,700) in pesos: the wide currency symbol is what pushed the
  // sign onto its own line in the narrow sidebar.
  const pesos = {
    user: userProfile({ currentBalance: 70_000, initialBalance: 70_000, preferences: { currency: "PHP" } as never }),
    incomeSources: [
      incomeSource({ id: "pay", name: "Payroll", amount: 12_700, frequency: "monthly", startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
    ],
    expenseRules: [
      fixedExpense({ id: "rent", name: "Rent", amount: 32_190.68, frequency: "monthly", startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
    ],
  };

  /** Signed amounts in the sidebar, with the number of text lines each is laid out on. */
  const signedAmounts = (page: Page) =>
    sidebar(page)
      .locator("p")
      .evaluateAll((ps) =>
        ps
          .filter((p) => /^[+-]/.test((p.textContent ?? "").trim()))
          .map((p) => {
            const range = document.createRange();
            range.selectNodeContents(p);
            const lines = new Set(Array.from(range.getClientRects()).map((r) => Math.round(r.top))).size;
            return { text: (p.textContent ?? "").trim(), lines };
          })
      );

  for (const width of [1280, 1440]) {
    test(`${width}px: the range panel and a day panel print the sign and the amount on one line`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await boot(page, pesos);
      const range = await signedAmounts(page);
      expect(range.map((a) => a.text)).toEqual(expect.arrayContaining(["+₱12,700.00", "-₱32,190.68"]));
      expect(range.filter((a) => a.lines !== 1), "range panel").toEqual([]);

      await selectDay(monthCell(page, "2026-03", "2026-03-13"));
      await expect(sidebar(page)).toContainText("Friday, Mar 13");
      const day = await signedAmounts(page);
      expect(day.length).toBeGreaterThan(0);
      expect(day.filter((a) => a.lines !== 1), "day panel").toEqual([]);
    });
  }
});
