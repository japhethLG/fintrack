/**
 * Failed Firestore writes: does the UI tell the user, and is the store left
 * consistent? Invariant after every failure:
 *     users/{uid}.currentBalance == initialBalance + sum(signed completed transactions)
 * Faults come from the harness (`setFault`). NOTE: the fake fails a write
 * before applying it; real Firestore can also fail with the write applied
 * server-side (ack lost) - not modelled here.
 */
import {
  test,
  expect,
  seedAndLogin,
  userProfile,
  fixedExpense,
  incomeSource,
  transaction,
  completedTransaction,
  readCollection,
  setFault,
  COLLECTIONS,
} from "../../index";
import { addFixedExpenseViaWizard, balanceInvariant, FAULT_TEXT, openTransaction } from "./support";

const GYM = fixedExpense({ id: "r1", name: "Gym", amount: 50, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } });
const BALANCE_1000 = userProfile({ currentBalance: 1000, initialBalance: 1000 });

const seedGym = (page: Parameters<typeof seedAndLogin>[0]) =>
  seedAndLogin(page, { user: BALANCE_1000, expenseRules: [GYM] }, { path: "/calendar" });

const completedDocs = async (page: Parameters<typeof seedAndLogin>[0]) =>
  (await readCollection<{ status: string }>(page, COLLECTIONS.transactions)).filter((t) => t.status === "completed");

test.describe("complete a projected occurrence (write txn -> adjust balance -> ...)", () => {
  test("rejected transaction write: error is shown, nothing is stored, retry succeeds once", async ({ page }) => {
    await seedGym(page);
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.transactions], times: 1 });
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible();
    expect(await readCollection(page, COLLECTIONS.transactions)).toEqual([]);
    expect(await balanceInvariant(page)).toMatchObject({ current: 1000, expected: 1000, drift: 0 });

    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal).toBeHidden();
    expect(await completedDocs(page)).toHaveLength(1);
    expect(await balanceInvariant(page)).toMatchObject({ current: 950, expected: 950, drift: 0 });
  });

  test("rejected balance write: the user is told (error shown in the modal)", async ({ page }) => {
    await seedGym(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.users], times: 1 });
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible();
    await expect(modal).toBeVisible(); // stays open so the user can retry
  });

  test("rejected balance write must not leave a completed transaction without its balance change", async ({ page }) => {
    await seedGym(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.users], times: 1 });
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible(); // precondition: failure was reported
    const inv = await balanceInvariant(page);
    expect(inv.drift, `current=${inv.current} expected=${inv.expected} completed=${inv.completed}`).toBe(0);
  });

  test("retrying after a rejected balance write must not create a second completed transaction", async ({ page }) => {
    await seedGym(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.users], times: 1 });
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible(); // precondition
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal).toBeHidden();
    const docs = await completedDocs(page);
    expect(docs).toHaveLength(1);
    expect((await balanceInvariant(page)).drift).toBe(0);
  });

  test("skip: rejected write shows the error and stores nothing", async ({ page }) => {
    await seedGym(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.transactions], times: 1 });
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: /Skip$/ }).first().click();
    await modal.getByRole("button", { name: "Skip Transaction" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible();
    expect(await readCollection(page, COLLECTIONS.transactions)).toEqual([]);
  });
});

test.describe("complete / edit a stored (manual) transaction (adjust balance -> update doc)", () => {
  test("rejected transaction update must not leave the balance changed while the doc is unchanged", async ({ page }) => {
    await seedAndLogin(
      page,
      { user: BALANCE_1000, transactions: [transaction({ id: "m1", name: "Manual Bill", scheduledDate: "2026-03-12", projectedAmount: 60 })] },
      { path: "/transactions" }
    );
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.transactions], times: 1 });
    const modal = await openTransaction(page, "Manual Bill");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible(); // precondition: reported
    const inv = await balanceInvariant(page);
    expect(inv.drift, `current=${inv.current} expected=${inv.expected}`).toBe(0);
  });

  test("rejected amount change on a completed transaction must not shift the balance", async ({ page }) => {
    await seedAndLogin(
      page,
      {
        user: userProfile({ currentBalance: 940, initialBalance: 1000 }),
        transactions: [completedTransaction({ id: "c1", name: "Paid Bill", scheduledDate: "2026-03-05", projectedAmount: 60, sourceType: "manual" })],
      },
      { path: "/transactions" }
    );
    expect(await balanceInvariant(page)).toMatchObject({ drift: 0 }); // precondition: seed is consistent
    const modal = await openTransaction(page, "Paid Bill");
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.transactions], times: 1 });
    await modal.getByLabel("Actual Amount").fill("80");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal.getByText(FAULT_TEXT)).toBeVisible();
    const inv = await balanceInvariant(page);
    expect(inv.drift, `current=${inv.current} expected=${inv.expected}`).toBe(0);
  });
});

test.describe("rules, balance and reset", () => {
  test("override balance: rejected write shows an error, no success banner, balance unchanged", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile({ currentBalance: 500, initialBalance: 500 }) }, { path: "/settings" });
    await page.getByRole("button", { name: "Override Current Balance" }).click();
    await page.getByLabel("Override Current Balance").fill("9999");
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.users], times: 1 });
    await page.getByRole("button", { name: "Override Balance" }).click();
    await expect(page.getByText(FAULT_TEXT)).toBeVisible();
    await expect(page.getByText("Balance updated successfully!")).toHaveCount(0);
    expect((await balanceInvariant(page)).current).toBe(500);
  });

  test("add a Fixed expense: a rejected write must be reported to the user", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile() }, { path: "/expenses" });
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.expenseRules] });
    await addFixedExpenseViaWizard(page, "Doomed Rent", 500);
    // preconditions: the write really was attempted and rejected, nothing stored
    expect(await readCollection(page, COLLECTIONS.expenseRules)).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.body.innerText)).toMatch(FAULT_TEXT);
  });

  test("delete a rule: a rejected write must be reported (and the rule must remain)", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile(), expenseRules: [fixedExpense({ id: "r1", name: "Gym" })] }, { path: "/expenses" });
    await page.getByRole("heading", { name: "Gym" }).first().click();
    await setFault(page, { code: "permission-denied", collections: [COLLECTIONS.expenseRules] });
    await page.getByRole("button", { name: /Delete/ }).click();
    await page.getByRole("button", { name: "Yes, Delete" }).click();
    expect((await readCollection(page, COLLECTIONS.expenseRules)).map((r) => r.id)).toEqual(["r1"]); // precondition
    await expect.poll(() => page.evaluate(() => document.body.innerText)).toMatch(FAULT_TEXT);
  });

  test("deactivate a rule: a rejected write must be reported", async ({ page }) => {
    await seedAndLogin(page, { user: userProfile(), expenseRules: [fixedExpense({ id: "r1", name: "Gym" })] }, { path: "/expenses" });
    await page.getByRole("heading", { name: "Gym" }).first().click();
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.expenseRules], times: 1 });
    await page.getByRole("button", { name: /Deactivate/ }).click();
    expect(((await readCollection<{ isActive: boolean }>(page, COLLECTIONS.expenseRules))[0]).isActive).toBe(true); // precondition
    await expect.poll(() => page.evaluate(() => document.body.innerText)).toMatch(FAULT_TEXT);
  });

  const resetAll = async (page: Parameters<typeof seedAndLogin>[0]) => {
    await page.getByRole("button", { name: "Selective Reset" }).click();
    await page.getByTestId("selective-reset-modal").getByText("All Financial Data").click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder(/Type "DELETE"/).fill("DELETE");
    await page.getByRole("button", { name: "Reset Selected Data" }).click();
  };
  const seedForReset = (page: Parameters<typeof seedAndLogin>[0]) =>
    seedAndLogin(
      page,
      {
        user: userProfile({ currentBalance: 940, initialBalance: 1000 }),
        incomeSources: [incomeSource({ id: "i1", name: "Acme Payroll" })],
        expenseRules: [fixedExpense({ id: "r1", name: "Gym" })],
        transactions: [completedTransaction({ id: "c1", name: "Paid Bill", scheduledDate: "2026-03-05", projectedAmount: 60, sourceType: "manual" })],
      },
      { path: "/settings" }
    );

  test("reset all data: a rejected transaction delete shows an error, no success banner, balance intact", async ({ page }) => {
    await seedForReset(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.transactions] });
    await resetAll(page);
    await expect(page.getByText(FAULT_TEXT)).toBeVisible();
    await expect(page.getByText(/reset successfully/)).toHaveCount(0);
    expect((await balanceInvariant(page)).current).toBe(940);
    expect((await readCollection(page, COLLECTIONS.transactions)).map((t) => t.id)).toEqual(["c1"]);
  });

  test("a failed reset must not delete part of the data", async ({ page }) => {
    await seedForReset(page);
    await setFault(page, { code: "unavailable", collections: [COLLECTIONS.transactions] });
    await resetAll(page);
    await expect(page.getByText(FAULT_TEXT)).toBeVisible(); // precondition: failure reported
    expect((await readCollection(page, COLLECTIONS.transactions)).map((t) => t.id)).toEqual(["c1"]);
    expect((await readCollection(page, COLLECTIONS.incomeSources)).map((t) => t.id)).toEqual(["i1"]);
    expect((await readCollection(page, COLLECTIONS.expenseRules)).map((t) => t.id)).toEqual(["r1"]);
  });
});
