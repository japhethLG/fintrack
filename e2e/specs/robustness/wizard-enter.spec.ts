/**
 * MANUAL-M3 (docs/audit/manual-test-2026-10-01.md): Enter in a wizard's date field saved the rule.
 *
 * The browser submits a form on Enter when it has a single text field, even with no submit button.
 * A weekly variable expense's Schedule step is its LAST step, and its only text field is the date (the
 * selects are native <select>s), so confirming a typed date with Enter created the rule on the spot.
 * The wizards now save only from their Create button.
 */
import type { Page } from "@playwright/test";
import { test, expect, seedAndLogin, userProfile, readCollection, COLLECTIONS } from "../../index";

const pick = async (page: Page, label: RegExp, option: string): Promise<void> => {
  const el = page.getByLabel(label).first();
  if ((await el.evaluate((e) => e.tagName)) === "SELECT") {
    await el.selectOption({ label: option });
  } else {
    await el.click();
    await page.getByRole("option", { name: option, exact: true }).first().click();
  }
};

const typeDateAndPressEnter = async (page: Page, fieldLabel: string, mmddyyyy: string): Promise<void> => {
  const date = page.getByText(fieldLabel, { exact: false }).locator("xpath=following::input[1]");
  await date.click();
  await date.press("Control+a");
  await date.pressSequentially(mmddyyyy);
  await date.press("Enter");
};

const rules = (page: Page, collection: string) => readCollection<{ name: string; startDate: string }>(page, collection);

test("expense wizard: Enter in the last step's date field confirms the date and does not create the rule", async ({ page }) => {
  await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }) }, { path: "/expenses" });
  await page.getByRole("button", { name: /Add Expense/ }).first().click();
  await page.getByRole("heading", { name: "Variable", level: 4 }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Expense Name/).fill("Groceries");
  await page.locator("#amount").fill("2500");
  await page.getByRole("button", { name: "Continue" }).click();
  await pick(page, /Frequency/, "Weekly");

  await typeDateAndPressEnter(page, "First Payment Date", "03/20/2026");

  const create = page.getByRole("button", { name: "Create Expense" });
  await expect(create).toBeVisible();
  await page.waitForTimeout(500); // a submit, if any, would have written by now
  expect(await rules(page, COLLECTIONS.expenseRules)).toHaveLength(0);

  await create.click();
  await expect.poll(async () => (await rules(page, COLLECTIONS.expenseRules)).map((r) => [r.name, r.startDate])).toEqual([
    ["Groceries", "2026-03-20"],
  ]);
});

test("income wizard: Enter in the Start Date field neither saves nor skips the step", async ({ page }) => {
  await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }) }, { path: "/income" });
  await page.getByRole("button", { name: /Add Income/ }).first().click();
  await page.getByRole("heading", { name: "Freelance", level: 4 }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel(/Source Name/).fill("Design work");
  await page.getByLabel(/^Amount/).fill("1500");
  await page.getByRole("button", { name: "Continue" }).click();
  await pick(page, /Frequency/, "One-time");

  await typeDateAndPressEnter(page, "Start Date", "03/20/2026");

  await expect(page.getByText("Schedule Configuration")).toBeVisible();
  await page.waitForTimeout(500);
  expect(await rules(page, COLLECTIONS.incomeSources)).toHaveLength(0);
});
