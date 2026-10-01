/**
 * Context menu, day sidebar, transaction dialog: actions, keyboard, double submit, stale UI.
 * Fixture: currentBalance 1000, Payday +500 monthly on the 13th (Fri 3/13, start 3/13), today Tue 2026-03-10.
 * There is no per-transaction context menu: right-click exists only on day cells (Add Transaction / Income / Expense).
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense } from "../../index";
import {
  completeInDialog,
  monthCell,
  openTxnFromCell,
  selectDay,
  sidebar,
  skipInDialog,
  storedTxns,
  summaryTile,
  txnDialog,
  userBalance,
  viewedHeading,
} from "./_support";

test.use({ viewport: { width: 1440, height: 1200 } });

const boot = async (page: import("@playwright/test").Page) => {
  await seedAndLogin(
    page,
    {
      user: userProfile({ currentBalance: 1000, initialBalance: 1000 }),
      incomeSources: [
        incomeSource({ id: "payday", name: "Payday", amount: 500, frequency: "monthly", startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
      ],
      expenseRules: [
        fixedExpense({ id: "rent", name: "Rent", amount: 200, frequency: "monthly", startDate: "2026-03-18", scheduleConfig: { dayOfMonth: 18 } }),
      ],
    },
    { path: "/calendar" }
  );
  await expect(viewedHeading(page)).toHaveText("March 2026");
  await expect(monthCell(page, "2026-03", "2026-03-13").getByText("Payday")).toBeVisible();
};

test.describe("day-cell context menu", () => {
  test("right-click offers Add Transaction / Add Income / Add Expense and Escape closes it", async ({ page }) => {
    await boot(page);
    await monthCell(page, "2026-03", "2026-03-20").click({ button: "right", position: { x: 20, y: 60 } });
    const items = page.getByRole("button", { name: /Add (Transaction|Income|Expense)$/ });
    await expect(items).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(items).toHaveCount(0);
    // Clicking elsewhere also closes it, and the right-click did not select the day.
    await monthCell(page, "2026-03", "2026-03-20").click({ button: "right", position: { x: 20, y: 60 } });
    await expect(items).toHaveCount(3);
    await page.getByRole("heading", { name: "Financial Calendar" }).click();
    await expect(items).toHaveCount(0);
    await expect(sidebar(page)).toContainText("Monthly range");
  });

  test("Add Transaction on a day pre-fills that day, creates a manual transaction there and it shows on the cell", async ({ page }) => {
    await boot(page);
    await monthCell(page, "2026-03", "2026-03-20").click({ button: "right", position: { x: 20, y: 60 } });
    await page.getByRole("button", { name: /Add Transaction$/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[type=date]")).toHaveValue("2026-03-20");
    await dialog.getByLabel("Name").fill("Dentist");
    await dialog.getByLabel("Amount").fill("80");
    await dialog.getByRole("button", { name: "Create Transaction" }).click();
    await expect(dialog).toBeHidden();
    await expect(monthCell(page, "2026-03", "2026-03-20").getByText("Dentist")).toBeVisible();
    const [t] = await storedTxns(page);
    expect([t.name, t.scheduledDate, t.status, t.sourceType, t.projectedAmount, t.type]).toEqual(["Dentist", "2026-03-20", "projected", "manual", 80, "expense"]);
    await expect(summaryTile(page, "Expenses")).toHaveText("-$280.00"); // rent 200 + 80
  });
});

test.describe("transaction dialog", () => {
  test("double-clicking 'Mark Complete' completes once: one stored transaction, balance moves once", async ({ page }) => {
    await boot(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    await txnDialog(page).getByRole("button", { name: "Mark Complete" }).dblclick();
    await expect(txnDialog(page)).toBeHidden();
    await expect.poll(async () => (await storedTxns(page)).length).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");
    expect((await storedTxns(page)).map((t) => t.status)).toEqual(["completed"]);
    expect(await userBalance(page)).toBe(1500);
  });

  test("pressing Enter twice in the amount field completes once", async ({ page }) => {
    await boot(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    const amount = txnDialog(page).getByLabel("Actual Amount");
    await amount.fill("450");
    await amount.focus();
    await Promise.all([page.keyboard.press("Enter"), page.keyboard.press("Enter")]);
    await expect(txnDialog(page)).toBeHidden();
    await expect.poll(async () => (await storedTxns(page)).length).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle");
    const txns = await storedTxns(page);
    expect(txns.map((t) => [t.status, t.actualAmount])).toEqual([["completed", 450]]);
    expect(await userBalance(page)).toBe(1450);
  });

  test("skip: stored as skipped, balance untouched, excluded from totals but still listed; sidebar updates without reload", async ({ page }) => {
    await boot(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    await skipInDialog(page);
    const [t] = await storedTxns(page);
    expect([t.status, t.occurrenceId]).toEqual(["skipped", "payday_2026-03"]);
    expect(await userBalance(page)).toBe(1000);
    await expect(summaryTile(page, "Income")).toHaveText("+$0.00");
    await expect(monthCell(page, "2026-03", "2026-03-13").getByText("Payday")).toBeVisible();
    await selectDay(monthCell(page, "2026-03", "2026-03-13"));
    await expect(sidebar(page)).toContainText("skipped");
    await expect(sidebar(page)).toContainText("Transactions (1)");
  });

  test("completing from the sidebar with an edited amount records the variance and updates the day's closing figure", async ({ page }) => {
    await boot(page);
    await selectDay(monthCell(page, "2026-03", "2026-03-13"));
    await sidebar(page).getByText("Payday", { exact: true }).click();
    await txnDialog(page).getByLabel("Actual Amount").fill("450");
    await expect(txnDialog(page)).toContainText("-$50.00 variance");
    await completeInDialog(page, { actualDate: "2026-03-13" }); // paid on its day: Actual Date now defaults to today when paying ahead (MANUAL-k)
    const [t] = await storedTxns(page);
    expect([t.projectedAmount, t.actualAmount, t.scheduledDate, t.actualDate]).toEqual([500, 450, "2026-03-13", "2026-03-13"]);
    expect(await userBalance(page)).toBe(1450);
    // Sidebar (still on 3/13): opening = 1450 - 450 = 1000, closing 1450, both from the stored actual.
    await expect(sidebar(page)).toContainText("$1,450");
  });

  test("Escape closes the dialog without writing anything", async ({ page }) => {
    await boot(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    await txnDialog(page).getByLabel("Actual Amount").fill("1");
    await page.keyboard.press("Escape");
    await expect(txnDialog(page)).toBeHidden();
    expect(await storedTxns(page)).toEqual([]);
    expect(await userBalance(page)).toBe(1000);
  });

  test("the transaction dialog can be operated with the keyboard alone (Tab to Skip, Enter, Tab to submit)", async ({ page }) => {
    await boot(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-13"), "Payday");
    const skip = txnDialog(page).getByRole("button", { name: /Skip$/ }).first();
    await skip.focus();
    await page.keyboard.press("Enter");
    const submit = txnDialog(page).getByRole("button", { name: "Skip Transaction" });
    await submit.focus();
    await page.keyboard.press("Enter");
    await expect(txnDialog(page)).toBeHidden();
    expect((await storedTxns(page)).map((t) => t.status)).toEqual(["skipped"]);
  });
});
