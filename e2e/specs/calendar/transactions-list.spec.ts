/**
 * /transactions: virtualised list (react-window) with 310 seeded rows, filters, sorting, date-range picker,
 * summary tiles, and the timezone-sensitive bits (row date, overdue tile, "Add Transaction" default date).
 * There is NO search box on this page (nothing to test there; noted in the report).
 *
 * Fixture (manual transactions only, today = Tue 2026-03-10). Txn NNN has amount NNN:
 *   001..240  projected, dated 3/11 + (i mod 20) days   (future)      income when i mod 3 == 0
 *   241..280  completed, dated 3/1 + (i mod 9) days
 *   281..300  skipped,   dated 3/5
 *   301..310  projected, dated 3/5                       (overdue)
 * Hand counts: total 310 | completed 40 | pending(projected) 250 | overdue 10 | skipped 20
 *   income (i mod 3 == 0, i<=310) = 103, expense = 207.
 */
import { test, expect, seedAndLogin, userProfile, transaction, completedTransaction, knownDefect } from "../../index";
import { addDaysISO } from "./_support";

const pad = (i: number) => String(i).padStart(3, "0");
const seedTxns = () => {
  const out = [];
  for (let i = 1; i <= 310; i++) {
    const base = { id: `t${pad(i)}`, name: `Txn ${pad(i)}`, projectedAmount: i, type: (i % 3 === 0 ? "income" : "expense") as "income" | "expense" };
    if (i <= 240) out.push(transaction({ ...base, scheduledDate: addDaysISO("2026-03-11", i % 20) }));
    else if (i <= 280) out.push(completedTransaction({ ...base, scheduledDate: addDaysISO("2026-03-01", i % 9) }));
    else if (i <= 300) out.push(transaction({ ...base, status: "skipped", scheduledDate: "2026-03-05" }));
    else out.push(transaction({ ...base, scheduledDate: "2026-03-05" }));
  }
  return out;
};

const tile = (page: import("@playwright/test").Page, label: string) =>
  page.locator("p", { hasText: new RegExp(`^${label}$`) }).first().locator("xpath=following-sibling::p[1]");
const heading = (page: import("@playwright/test").Page) => page.getByRole("heading", { level: 3, name: /^Transactions \(/ });
const rows = (page: import("@playwright/test").Page) => page.locator("div.p-4.border-b.cursor-pointer");
const scroller = (page: import("@playwright/test").Page) => page.locator("div[style*='height: 600px']").first();

const pick = async (page: import("@playwright/test").Page, label: string, option: string) => {
  await page.getByText(label, { exact: true }).locator("xpath=following::button[@role='combobox'][1]").click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const boot = async (page: import("@playwright/test").Page) => {
  await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }), transactions: seedTxns() }, { path: "/transactions" });
  await expect(heading(page)).toHaveText("Transactions (310)");
};

test.describe("310 rows", () => {
  test("summary tiles and header match hand counts", async ({ page }) => {
    await boot(page);
    await expect(tile(page, "Total")).toHaveText("310");
    await expect(tile(page, "Completed")).toHaveText("40");
    await expect(tile(page, "Pending")).toHaveText("250");
    await expect(tile(page, "Overdue")).toHaveText("10");
  });

  test("the list is virtualised: few rows in the DOM, and scrolling reaches the last row", async ({ page }) => {
    await boot(page);
    const n = await rows(page).count();
    expect(n).toBeGreaterThan(3);
    expect(n).toBeLessThan(30);
    await pick(page, "Sort By", "Amount");
    await expect(rows(page).first()).toContainText("Txn 001");
    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(rows(page).filter({ hasText: "Txn 310" })).toBeVisible();
    await expect(rows(page).filter({ hasText: "Txn 001" })).toHaveCount(0);
    expect(await rows(page).count()).toBeLessThan(30);
  });

  test("status filter, type filter and their combination; header count follows, tiles do not", async ({ page }) => {
    await boot(page);
    await pick(page, "Status", "Completed");
    await expect(heading(page)).toHaveText("Transactions (40)");
    await pick(page, "Status", "Skipped");
    await expect(heading(page)).toHaveText("Transactions (20)");
    await pick(page, "Status", "All Status");
    await pick(page, "Type", "Income");
    await expect(heading(page)).toHaveText("Transactions (103)");
    await pick(page, "Type", "Expenses");
    await expect(heading(page)).toHaveText("Transactions (207)");
    await pick(page, "Status", "Completed");
    // completed = 241..280 (40); of those multiples of 3: 243..279 = 13 => expenses 27.
    await expect(heading(page)).toHaveText("Transactions (27)");
    await expect(tile(page, "Total")).toHaveText("310"); // tiles ignore status/type filters
    await page.getByRole("button", { name: "Clear Filters" }).click();
    await expect(heading(page)).toHaveText("Transactions (310)");
  });

  test("sort by amount descending / ascending and by date", async ({ page }) => {
    await boot(page);
    await pick(page, "Sort By", "Amount");
    await pick(page, "Order By", "Descending");
    await expect(rows(page).first()).toContainText("Txn 310");
    await expect(rows(page).first()).toContainText("$310.00");
    await pick(page, "Order By", "Ascending");
    await expect(rows(page).first()).toContainText("Txn 001");
    await pick(page, "Sort By", "Date");
    // Earliest stored date is 3/1 = completed rows with i mod 9 == 0 (243, 252, 261, 270, 279). The rendered date
    // text is deliberately not asserted here: it is off by a day in New York (E2E-TXN-01 below).
    await expect(rows(page).first()).toContainText(/Txn (243|252|261|270|279)/);
  });

  test("date-range picker: typed 03/12/2026 - 03/13/2026 selects exactly those days (24 rows)", async ({ page }, testInfo) => {
    await boot(page);
    await page.getByPlaceholder("Start date").fill("03/12/2026");
    await page.keyboard.press("Enter");
    await page.getByPlaceholder("End date").fill("03/13/2026");
    await page.keyboard.press("Enter");
    // i mod 20 == 1 (3/12) and == 2 (3/13): 12 each.
    await expect(heading(page)).toHaveText("Transactions (24)");
    await expect(tile(page, "Total")).toHaveText("24");
    await pick(page, "Sort By", "Date");
    await pick(page, "Order By", "Ascending");
    // The store value is the picked day in every timezone: the first row is dated 3/12, the last 3/13.
    const first = (await rows(page).first().innerText());
    expect(first).toMatch(/Txn (001|021|041|061|081|101|121|141|161|181|201|221)/);
    await pick(page, "Order By", "Descending");
    expect(await rows(page).first().innerText()).toMatch(/Txn (002|022|042|062|082|102|122|142|162|182|202|222)/);
    void testInfo;
  });

  test("rows show the stored scheduled date (3/12/2026 for scheduledDate 2026-03-12), in every timezone", async ({ page }, testInfo) => {
    if (testInfo.project.name === "America/New_York") {
      knownDefect("E2E-TXN-01", "America/New_York: the row date is rendered from new Date('2026-03-12') (UTC midnight) and shows 3/11/2026, a day early");
    }
    await boot(page);
    await pick(page, "Sort By", "Date");
    await pick(page, "Order By", "Descending");
    // latest date = 3/30 (i mod 20 == 19): Txn 019 etc.
    await expect(rows(page).first()).toContainText("3/30/2026");
  });
});

for (const c of [
  { project: "Asia/Manila", now: "2026-03-10T20:00:00Z", local: "2026-03-11" }, // 04:00 on 3/11 in Manila; still 3/10 in UTC
  { project: "America/New_York", now: "2026-03-11T02:00:00Z", local: "2026-03-10" }, // 22:00 on 3/10 in New York; already 3/11 in UTC
] as const) {
  test.describe(`near midnight UTC (${c.now})`, () => {
    test.use({ now: c.now });

    test(`overdue tile uses the user's local date: a bill dated 3/10 is overdue only when local today > 3/10`, async ({ page }, testInfo) => {
      const localToday = c.project === testInfo.project.name ? c.local : undefined;
      if (localToday !== undefined) {
        knownDefect("E2E-TXN-02", `${c.project}: overdue/'today' is computed from toISOString() (UTC date) so it disagrees with the local date (local ${c.local})`);
      }
      await seedAndLogin(
        page,
        { user: userProfile(), transactions: [transaction({ id: "bill", name: "Bill", scheduledDate: "2026-03-10", projectedAmount: 50 })] },
        { path: "/transactions" }
      );
      await expect(heading(page)).toHaveText("Transactions (1)");
      const local = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
      await expect(tile(page, "Overdue")).toHaveText(local > "2026-03-10" ? "1" : "0");
    });

    test(`'Add Transaction' pre-fills today's LOCAL date`, async ({ page }, testInfo) => {
      if (c.project === testInfo.project.name) {
        knownDefect("E2E-TXN-03", `${c.project}: default date comes from toISOString() and is the UTC day, not the local day`);
      }
      await seedAndLogin(page, { user: userProfile() }, { path: "/transactions" });
      await page.getByRole("button", { name: /Add Transaction/ }).click();
      const local = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));
      await expect(page.getByRole("dialog").locator("input[type=date]")).toHaveValue(local);
    });
  });
}
