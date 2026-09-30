/** Two tabs of one session acting on the same data. */
import { test, expect, seedAndLogin, userProfile, fixedExpense, readCollection, knownDefect, COLLECTIONS } from "../../index";
import { balanceInvariant, openTransaction, txnModal, FAULT_TEXT } from "./support";

const GYM = fixedExpense({ id: "r1", name: "Gym", amount: 50, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } });
const seed = { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }), expenseRules: [GYM] };

test("completing the same occurrence from a stale second tab must not double-count", async ({ page, context }) => {
  knownDefect("E2E-ROB-11", "second tab's still-open modal creates a second completed 'Gym' doc for r1_2026-03 (balance 900 vs 950 expected)");
  await seedAndLogin(page, seed, { path: "/calendar" });
  const tab2 = await context.newPage();
  await tab2.goto("/calendar");
  const m1 = await openTransaction(page, "Gym");
  const m2 = await openTransaction(tab2, "Gym");
  await m1.getByRole("button", { name: "Mark Complete" }).click();
  await expect(m1).toBeHidden();
  await expect.poll(async () => (await balanceInvariant(page)).current).toBe(950);
  await expect(m2).toBeVisible(); // precondition: tab 2 still shows the stale, open modal
  await m2.getByRole("button", { name: "Mark Complete" }).click();
  await expect(m2).toBeHidden();
  const completed = (await readCollection<{ status: string }>(page, COLLECTIONS.transactions)).filter((t) => t.status === "completed");
  expect(completed).toHaveLength(1);
  expect((await balanceInvariant(page)).current).toBe(950);
});

test("a rule deleted in tab 1 makes tab 2's open occurrence fail cleanly (error shown, nothing written)", async ({ page, context }) => {
  await seedAndLogin(page, seed, { path: "/expenses" });
  const tab2 = await context.newPage();
  await tab2.goto("/calendar");
  await openTransaction(tab2, "Gym");
  await page.getByRole("heading", { name: "Gym" }).first().click();
  await page.getByRole("button", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Yes, Delete" }).click();
  await expect.poll(async () => (await readCollection(page, COLLECTIONS.expenseRules)).length).toBe(0);
  const m2 = txnModal(tab2);
  await m2.getByRole("button", { name: "Mark Complete" }).click();
  await expect(m2.getByText(/Source not found for projection/)).toBeVisible();
  expect(await readCollection(page, COLLECTIONS.transactions)).toEqual([]);
  expect(await balanceInvariant(page)).toMatchObject({ current: 1000, drift: 0 });
  void FAULT_TEXT;
});
