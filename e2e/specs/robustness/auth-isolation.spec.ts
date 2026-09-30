/**
 * Auth/session edges and data isolation between users of the same browser.
 * Two users: Alice (uid user-a, balance 1111) and Bob (uid user-b, balance 2222).
 */
import {
  test,
  expect,
  seedAndLogin,
  userProfile,
  fixedExpense,
  incomeSource,
  completedTransaction,
  readCollection,
  readDocument,
  readStore,
  signInAs,
  knownDefect,
  expectAppPath,
  COLLECTIONS,
} from "../../index";
import { addIncomeViaWizard, loginViaForm } from "../../helpers/flows";
import { APP_PAGES, openTransaction, txnModal, watchTab } from "./support";

const ALICE = userProfile({ uid: "user-a", email: "a@example.com", displayName: "Alice Aardvark", currentBalance: 1111, initialBalance: 1111 });
const BOB = userProfile({ uid: "user-b", email: "b@example.com", displayName: "Bob Bobcat", currentBalance: 2222, initialBalance: 2222 });
const BOB_IDENTITY = { uid: "user-b", email: "b@example.com", displayName: "Bob Bobcat" };

const twoUsers = () => ({
  user: ALICE,
  incomeSources: [
    incomeSource({ id: "ia", userId: "user-a", name: "Alice Payroll", amount: 3333, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } }),
    incomeSource({ id: "ib", userId: "user-b", name: "Bob Payroll", amount: 4444, startDate: "2026-03-13", scheduleConfig: { dayOfMonth: 13 } }),
  ],
  expenseRules: [fixedExpense({ id: "ea", userId: "user-a", name: "Alice Rent", amount: 555, startDate: "2026-03-14", scheduleConfig: { dayOfMonth: 14 } })],
  transactions: [
    completedTransaction({ id: "ta", userId: "user-a", name: "Alice Coffee", scheduledDate: "2026-03-05", projectedAmount: 7, sourceType: "manual" }),
    completedTransaction({ id: "tb", userId: "user-b", name: "Bob Sandwich", scheduledDate: "2026-03-06", projectedAmount: 9, sourceType: "manual" }),
  ],
  collections: { users: { "user-b": BOB as never } },
  accounts: { "b@example.com": { uid: "user-b", password: "pw-b" } },
});

const nav = (page: Parameters<typeof seedAndLogin>[0], label: string) =>
  page.getByRole("navigation").getByRole("button", { name: new RegExp(`${label}$`) }).click();

test.describe("switching users in one browser", () => {
  test("logout then form login as Bob shows only Bob's data on every page", async ({ page }) => {
    await seedAndLogin(page, twoUsers(), { path: "/income" });
    await expect(page.getByText("Alice Payroll").first()).toBeVisible();
    await page.getByRole("button", { name: /Logout/ }).click();
    await expectAppPath(page, "/login");
    await loginViaForm(page, "b@example.com", "pw-b");
    await expectAppPath(page, "/dashboard");
    await expect(page.getByText("$2,222.00").first()).toBeVisible();
    for (const [label, own, foreign] of [
      ["Income Manager", "Bob Payroll", "Alice Payroll"],
      ["Transactions", "Bob Sandwich", "Alice Coffee"],
      ["Expense Manager", "", "Alice Rent"],
    ] as const) {
      await nav(page, label);
      if (own) await expect(page.getByText(own).first()).toBeVisible();
      await expect(page.getByText(/Loading/)).toHaveCount(0);
      await expect(page.getByText(foreign)).toHaveCount(0);
    }
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/Alice|1,111/);
  });

  test("a write made as Bob is owned by Bob and leaves Alice's data untouched", async ({ page }) => {
    await seedAndLogin(page, twoUsers(), { path: "/dashboard" });
    await page.getByRole("button", { name: /Logout/ }).click();
    await loginViaForm(page, "b@example.com", "pw-b");
    await nav(page, "Income Manager");
    await addIncomeViaWizard(page, { name: "Bob Side Gig", amount: 100 });
    await expect(page.getByRole("heading", { name: "Bob Side Gig", level: 4 })).toBeVisible();
    const docs = await readCollection<{ name: string; userId: string }>(page, COLLECTIONS.incomeSources);
    expect(docs.find((d) => d.name === "Bob Side Gig")?.userId).toBe("user-b");
    expect(docs.find((d) => d.id === "ia")).toMatchObject({ userId: "user-a", name: "Alice Payroll", amount: 3333 });
    expect((await readDocument<{ currentBalance: number }>(page, COLLECTIONS.users, "user-a"))?.currentBalance).toBe(1111);
  });

  test("an auth switch without a logout (other tab signs in as Bob) swaps the data set", async ({ page, context }) => {
    await seedAndLogin(page, twoUsers(), { path: "/income" });
    await expect(page.getByText("Alice Payroll").first()).toBeVisible();
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await signInAs(tab2, BOB_IDENTITY);
    await expect(page.getByText("Bob Payroll").first()).toBeVisible();
    await expect(page.getByText("Alice Payroll")).toHaveCount(0);
  });

  test("a transaction modal opened as Alice must not survive a switch to Bob", async ({ page, context }) => {
    knownDefect("E2E-ROB-07", "Alice's transaction modal stays open (showing Alice's data) after the session became Bob's");
    await seedAndLogin(page, twoUsers(), { path: "/transactions" });
    await openTransaction(page, "Alice Coffee");
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await signInAs(tab2, BOB_IDENTITY);
    await expect(page.getByText("Bob Sandwich").first()).toBeVisible(); // precondition: page is now Bob's
    await expect(txnModal(page)).toBeHidden();
  });

  test("a stale Alice modal must not let Bob's session edit Alice's transaction or Bob's balance", async ({ page, context }) => {
    knownDefect("E2E-ROB-07", "completing the stale modal changes Bob's balance 2222 -> 2159 and rewrites Alice's transaction (uid taken from the new session)");
    await seedAndLogin(page, twoUsers(), { path: "/transactions" });
    const modal = await openTransaction(page, "Alice Coffee");
    const tab2 = await context.newPage();
    await tab2.goto("/dashboard");
    await signInAs(tab2, BOB_IDENTITY);
    await expect(page.getByText("Bob Sandwich").first()).toBeVisible();
    if (await modal.isVisible()) {
      await modal.getByLabel("Actual Amount").fill("70");
      await modal.getByRole("button", { name: "Mark Complete" }).click();
      await expect(modal).toBeHidden(); // submit finished (modal closes on success)
    }
    expect((await readDocument<{ currentBalance: number }>(page, COLLECTIONS.users, "user-b"))?.currentBalance, "Bob's balance").toBe(2222);
    expect((await readDocument<{ actualAmount: number }>(page, COLLECTIONS.transactions, "ta"))?.actualAmount, "Alice's txn").toBe(7);
  });
});

test.describe("routes, history and session in several tabs", () => {
  for (const p of APP_PAGES) {
    test(`signed out deep link to ${p.path} goes to /login and shows no data`, async ({ page }) => {
      await page.goto(p.path);
      await expectAppPath(page, "/login");
      await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
      expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/Alice|Balance/);
    });
  }

  test("browser Back after logout does not reveal protected pages", async ({ page }) => {
    await seedAndLogin(page, twoUsers());
    await nav(page, "Income Manager");
    await expect(page.getByText("Alice Payroll").first()).toBeVisible();
    await page.getByRole("button", { name: /Logout/ }).click();
    await expectAppPath(page, "/login");
    await page.goBack();
    await expectAppPath(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome Back" })).toBeVisible();
    expect(await page.evaluate(() => document.body.innerText)).not.toContain("Alice");
  });

  test("visiting /login or /signup while signed in redirects to the dashboard", async ({ page }) => {
    await seedAndLogin(page, twoUsers(), { path: "/login" });
    await expectAppPath(page, "/dashboard");
    await page.goto("/signup");
    await expectAppPath(page, "/dashboard");
  });

  test("reload while a modal is open closes it and performs no writes", async ({ page }) => {
    await seedAndLogin(page, twoUsers(), { path: "/transactions" });
    await openTransaction(page, "Alice Coffee");
    const before = (await readStore(page)).ops.length;
    await page.reload();
    await expect(page.getByText("Alice Coffee").first()).toBeVisible();
    await expect(txnModal(page)).toBeHidden();
    expect((await readStore(page)).ops.length).toBe(before);
  });

  test("signing out in one tab sends the other tab to /login without leaking data", async ({ page, context, diagnostics }) => {
    await seedAndLogin(page, twoUsers(), { path: "/income" });
    const tab2 = await context.newPage();
    watchTab(tab2, diagnostics);
    await tab2.goto("/expenses");
    await expect(tab2.getByText("Alice Rent").first()).toBeVisible();
    await page.getByRole("button", { name: /Logout/ }).click();
    await expectAppPath(tab2, "/login");
    expect(await tab2.evaluate(() => document.body.innerText)).not.toContain("Alice");
    expect(diagnostics.pageErrors).toEqual([]);
  });

  test("a completion made in one tab appears live in the other", async ({ page, context }) => {
    await seedAndLogin(
      page,
      { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }), expenseRules: [fixedExpense({ id: "r1", name: "Gym", amount: 50, startDate: "2026-03-12", scheduleConfig: { dayOfMonth: 12 } })] },
      { path: "/calendar" }
    );
    const tab2 = await context.newPage();
    await tab2.goto("/settings");
    await expect(tab2.getByText("$1,000.00").first()).toBeVisible();
    const modal = await openTransaction(page, "Gym");
    await modal.getByRole("button", { name: "Mark Complete" }).click();
    await expect(modal).toBeHidden();
    await expect(tab2.getByText("$950.00").first()).toBeVisible();
  });
});
