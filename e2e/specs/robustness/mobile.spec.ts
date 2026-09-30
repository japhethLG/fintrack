/** Phone (390x844, touch) and tablet (768x1024) layouts. */
import { test, expect, seedAndLogin, userProfile, fixedExpense, incomeSource, readCollection, COLLECTIONS, expectAppPath } from "../../index";
import { APP_PAGES, badTokens, horizontalOverflow, txnModal, balanceInvariant } from "./support";
import type { Page } from "@playwright/test";

const seed = {
  user: userProfile({ currentBalance: 12345.67, initialBalance: 12345.67 }),
  incomeSources: [incomeSource({ id: "i1", name: "Acme Payroll With A Really Long Company Name Incorporated", amount: 3000, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } })],
  expenseRules: [fixedExpense({ id: "e1", name: "Gym", amount: 50, startDate: "2026-03-14", scheduleConfig: { dayOfMonth: 14 } })],
};

const noOverflow = async (page: Page, where: string) => {
  const o = await horizontalOverflow(page);
  expect(o.scrollWidth, `${where}: scrollWidth ${o.scrollWidth} > innerWidth ${o.innerWidth}`).toBeLessThanOrEqual(o.innerWidth);
};

for (const vp of [{ name: "phone 390x844", width: 390, height: 844, mobile: true }, { name: "tablet 768x1024", width: 768, height: 1024, mobile: false }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: true });

    test("the menu reaches every page", async ({ page, diagnostics }) => {
      test.setTimeout(90_000);
      await seedAndLogin(page, seed, { path: "/dashboard" });
      for (const p of APP_PAGES.slice(1)) {
        await page.getByRole("button", { name: "Open menu" }).tap();
        await page.getByRole("button", { name: new RegExp(`${p.label}$`) }).tap();
        await expectAppPath(page, p.path);
        await expect(page.getByRole("heading", { name: p.h1, level: 1 })).toBeVisible();
      }
      expect(diagnostics.pageErrors).toEqual([]);
    });

    test("no page scrolls horizontally and no number is NaN", async ({ page }) => {
      test.setTimeout(90_000);
      await seedAndLogin(page, seed, { path: "/dashboard" });
      for (const p of APP_PAGES) {
        await page.goto(p.path);
        await expect(page.getByRole("heading", { name: p.h1, level: 1 })).toBeVisible();
        await expect(page.getByText(/^Loading/)).toHaveCount(0);
        await noOverflow(page, p.path);
        expect(await badTokens(page)).toEqual([]);
      }
    });

    test("dashboard shows the balance", async ({ page }) => {
      await seedAndLogin(page, seed, { path: "/dashboard" });
      await expect(page.getByText("$12,345.67").first()).toBeVisible();
    });

    test("a calendar transaction opens a modal that fits the screen and can be completed by tap", async ({ page }) => {
      await seedAndLogin(page, seed, { path: "/calendar" });
      await page.getByText("Gym", { exact: true }).first().tap();
      const modal = txnModal(page);
      await expect(modal).toBeVisible();
      const box = await modal.boundingBox();
      expect(box, "modal has a box").not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
      const submit = modal.getByRole("button", { name: "Mark Complete" });
      await submit.scrollIntoViewIfNeeded();
      const sb = await submit.boundingBox();
      expect(sb!.y + sb!.height).toBeLessThanOrEqual(vp.height);
      await submit.tap();
      await expect(modal).toBeHidden();
      expect((await readCollection<{ status: string }>(page, COLLECTIONS.transactions)).map((t) => t.status)).toEqual(["completed"]);
      expect(await balanceInvariant(page)).toMatchObject({ current: 12295.67, drift: 0 });
    });
  });
}
