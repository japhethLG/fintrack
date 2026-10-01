/**
 * JOURNEY 3 - one household, three timezones, clock at local 00:30 / 23:30 and on
 * month boundaries. The same assertions run in UTC, Asia/Manila and America/New_York;
 * a defect that only reproduces in some zones is gated on the project name so the
 * other zones assert normally.
 *
 * Household (USD, seeded): Acme Payroll semi-monthly on the 1st and 31st (last day
 * clamps: Feb 28, Apr 30, Jun 30) +1,000 each, start 2026-01-01; Rent monthly on the
 * 1st, -500, start 2026-01-01. Nothing is completed, so past occurrences are overdue.
 *
 * Default view window at a 2026-03-xx clock = 2026-01-01 .. 2026-06-30 (2 months back
 * to the end of the month 3 months ahead). Occurrences in it:
 *   payroll: Jan 1, Jan 31, Feb 1, Feb 28, Mar 1, Mar 31, Apr 1, Apr 30, May 1, May 31, Jun 1, Jun 30 = 12
 *   rent:    Jan 1, Feb 1, Mar 1, Apr 1, May 1, Jun 1 = 6           -> 18 rows
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, fixedExpense } from "../../index";
import * as S from "./support";

const NY = "America/New_York";
const MANILA = "Asia/Manila";

const household = () => ({
  user: userProfile({ currentBalance: 1000, initialBalance: 1000 }),
  incomeSources: [
    incomeSource({ name: "Acme Payroll", amount: 1000, frequency: "semi-monthly", startDate: "2026-01-01", scheduleConfig: { specificDays: [1, 31] } }),
  ],
  expenseRules: [fixedExpense({ name: "Rent", amount: 500, startDate: "2026-01-01", scheduleConfig: { dayOfMonth: 1 } })],
});

const at = async (page: import("@playwright/test").Page, tzName: string, ymd: string, hhmm: string) => {
  await page.clock.setFixedTime(new Date(S.localInstant(tzName, ymd, hhmm)));
};
const tzOf = (testInfo: import("@playwright/test").TestInfo) => testInfo.project.use.timezoneId as string;

const cell = (page: import("@playwright/test").Page, day: number) =>
  page.locator("div.min-h-\\[100px\\]:not(.opacity-50)").filter({ hasText: new RegExp(`^${day}(?!\\d)`) }).first();

test.describe("month-boundary paydays land on the right calendar day (all zones)", () => {
  const scenarios = [
    { name: "Mar 31 23:30 local", ymd: "2026-03-31", hhmm: "23:30", today: 31, month: "March 2026", days: [1, 31], nextMonth: "April 2026", nextDays: [1, 30], income: "+$2,000.00" },
    { name: "Apr 1 00:30 local", ymd: "2026-04-01", hhmm: "00:30", today: 1, month: "April 2026", days: [1, 30], nextMonth: "May 2026", nextDays: [1, 31], income: "+$2,000.00" },
    { name: "Feb 28 23:30 local", ymd: "2026-02-28", hhmm: "23:30", today: 28, month: "February 2026", days: [1, 28], nextMonth: "March 2026", nextDays: [1, 31], income: "+$2,000.00" },
    { name: "Mar 1 00:30 local", ymd: "2026-03-01", hhmm: "00:30", today: 1, month: "March 2026", days: [1, 31], nextMonth: "April 2026", nextDays: [1, 30], income: "+$2,000.00" },
  ];
  for (const s of scenarios) {
    test(`${s.name}: payday chips, month totals and today marker`, async ({ page }, testInfo) => {
      await at(page, tzOf(testInfo), s.ymd, s.hhmm);
      await seedAndLogin(page, household(), { path: "/calendar" });
      await expect(page.getByRole("heading", { name: "Financial Calendar", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: s.month, level: 2 })).toBeVisible();
      // today marker = the LOCAL date (cell with the primary border)
      const todayCell = page.locator("div.min-h-\\[100px\\].border-primary");
      await expect(todayCell).toHaveCount(1);
      await expect(todayCell).toHaveText(new RegExp(`^${s.today}(?!\\d)`));
      // Paydays on the 1st and the last day of this month (clamped) carry the payroll chip
      for (const d of s.days) await expect(cell(page, d), `day ${d} of ${s.month}`).toContainText("Acme Payroll");
      // ... and the days in between do not (spot-check the 2nd and the 15th)
      await expect(cell(page, 2)).not.toContainText("Acme Payroll");
      await expect(cell(page, 15)).not.toContainText("Acme Payroll");
      // month totals: 2 paydays = +$2,000 ; 1 rent = -$500 (Mon summary card)
      await expect(page.getByText("Income", { exact: true }).first().locator("xpath=following-sibling::p")).toHaveText(s.income);
      await expect(page.getByText("Expenses", { exact: true }).first().locator("xpath=following-sibling::p")).toHaveText("-$500.00");
      // next month
      await S.calendarShowMonth(page, s.nextMonth);
      for (const d of s.nextDays) await expect(cell(page, d), `day ${d} of ${s.nextMonth}`).toContainText("Acme Payroll");
    });
  }

  test("Dashboard period totals for March are +$2,000.00 / -$500.00 at 23:30 on Mar 31", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household());
    await expect(page.getByText("Financial overview for Mar 1 - Mar 31, 2026")).toBeVisible();
    await expect(page.getByText("+$2,000.00").first()).toBeVisible();
    await expect(page.getByText("-$500.00").first()).toBeVisible();
  });
});

test.describe("date labels and buckets (America/New_York shows the previous day)", () => {
  test("Dashboard Upcoming Activity labels Mar 31 / Apr 1 / Apr 1 at 23:30 on Mar 31", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household());
    await expect(page.getByRole("heading", { name: "Upcoming Activity" })).toBeVisible();
    const rows = page.locator("div.cursor-pointer.p-3.rounded-lg"); // QuickTransaction rows (Overview tab)
    await expect(rows).toHaveCount(3); // payroll Mar 31, payroll Apr 1, rent Apr 1 (Apr 30 is beyond 14 days)
    const texts = (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
    expect(texts[0]).toContain("Acme Payroll Mar 31");
    expect(texts[1]).toContain("Acme Payroll Apr 1");
    expect(texts[2]).toContain("Rent Apr 1");
  });

  test("Income > Upcoming Payments headings are TUESDAY, MAR 31 / WEDNESDAY, APR 1 (Next 30 days ends Apr 29)", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household(), { path: "/income" });
    await expect(page.getByRole("heading", { name: "Income Management", level: 1 })).toBeVisible();
    // REWRITTEN (decision: "Next N days" is exactly N days): from Mar 31 the 30-day window ends Apr 29,
    // so the Apr 30 payday (day 31) is out: 2 paydays = 2,000.
    await expect(page.getByText("Total Expected").locator("xpath=following-sibling::span")).toHaveText("$2,000.00");
    const heads = await page.locator("h4.uppercase").allInnerTexts();
    expect(heads, "two date groups").toHaveLength(2);
    expect(heads.map((h) => h.toUpperCase())).toEqual(["TUESDAY, MAR 31", "WEDNESDAY, APR 1"]);
  });

  test("Expenses > Upcoming Bills heading for the 1st is WEDNESDAY, APR 1", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household(), { path: "/expenses" });
    await expect(page.getByRole("heading", { name: "Expense Management", level: 1 })).toBeVisible();
    await expect(page.locator("h4.uppercase")).toHaveCount(1);
    await expect(page.locator("h4.uppercase")).toHaveText(/^WEDNESDAY, APR 1$/i);
  });

  test("Transactions list prints the scheduled date of the first rows as 1/1/2026", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household(), { path: "/transactions" });
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    await expect(page.getByText(/^Transactions \(\d+\)$/)).toBeVisible();
    const first = page.locator("div.cursor-pointer.border-b").first();
    await expect(first).toContainText("Acme Payroll");
    await expect(first).toContainText("1/1/2026");
    await expect(first).not.toContainText("12/31/2025");
  });

  test("Transactions header counts every occurrence of the default window (18 rows incl. Jun 30)", async ({ page }, testInfo) => {
    const tzName = tzOf(testInfo);
    await at(page, tzName, "2026-03-31", "23:30");
    await seedAndLogin(page, household(), { path: "/transactions" });
    await expect(page.getByRole("heading", { name: "Transactions", level: 1 })).toBeVisible();
    await expect(page.getByText("Transactions (18)")).toBeVisible();
  });

  test("Dashboard weekly chart is labelled Week of Mar 1 and Week of Mar 29 for the March paydays", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household());
    await expect(page.getByText("Weekly view")).toBeVisible();
    // Mar 1 is a Sunday (week starts Mar 1); Mar 31 is a Tuesday (week starts Sun Mar 29)
    await expect(page.getByText("Week of Mar 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Week of Mar 29", { exact: true })).toBeVisible();
  });

  test("Period Comparison for Mar 1-31 compares with Jan 29 - Feb 28 (income was $3,000)", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household());
    const card = page;
    // previous 31 days: payroll Jan 31 + Feb 1 + Feb 28 = 3,000 ; rent Feb 1 = 500
    await expect(card.getByText("vs Jan 29 - Feb 28")).toBeVisible();
    await expect(card.getByText("was $3,000.00", { exact: true })).toBeVisible();
    await expect(card.getByText("was $500.00", { exact: true }).first()).toBeVisible();
  });

  test("Income rule detail shows Start Date 1/1/2026", async ({ page }, testInfo) => {
    await at(page, tzOf(testInfo), "2026-03-31", "23:30");
    await seedAndLogin(page, household(), { path: "/income" });
    await expect(page.getByRole("heading", { name: "Income Management", level: 1 })).toBeVisible();
    await page.getByRole("heading", { name: "Acme Payroll", level: 4 }).click();
    await expect(page.getByText("Start Date").locator("xpath=following-sibling::p")).toHaveText("1/1/2026");
  });
});

test.describe("'today' seen by different screens (UTC-based vs local-based)", () => {
  // Overdue = scheduled before LOCAL today and not completed/skipped, inside the view window.
  // Mar 31 clock (window from Jan 1): 8 rows before Mar 31 (payroll Jan1,Jan31,Feb1,Feb28,Mar1 + rent Jan1,Feb1,Mar1).
  // Apr 1 clock (window from Feb 1): payroll Feb1,Feb28,Mar1,Mar31 + rent Feb1,Mar1 = 6.
  const cases = [
    { name: "23:30 on Mar 31", ymd: "2026-03-31", hhmm: "23:30", overdue: 8 },
    { name: "00:30 on Apr 1", ymd: "2026-04-01", hhmm: "00:30", overdue: 6 },
  ];
  for (const c of cases) {
    test(`Transactions 'Overdue' card equals the Dashboard overdue alert at ${c.name}`, async ({ page }, testInfo) => {
      await at(page, tzOf(testInfo), c.ymd, c.hhmm);
      await seedAndLogin(page, household());
      await expect(page.getByText(`${c.overdue} Overdue Transactions`)).toBeVisible();
      await S.gotoPage(page, "Transactions");
      await expect(page.getByText("Overdue", { exact: true }).locator("xpath=following-sibling::p")).toHaveText(String(c.overdue));
    });
  }

  for (const [tzName, ymd, hhmm] of [[NY, "2026-03-10", "23:30"], [MANILA, "2026-03-10", "00:30"]] as const) {
    test(`Add Income wizard defaults to the LOCAL date; first payment lands on it (${tzName} ${hhmm})`, async ({ page }, testInfo) => {
      const here = tzOf(testInfo);
      await at(page, here, ymd, hhmm);
      await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }) }, { path: "/income" });
      await expect(page.getByRole("heading", { name: "Income Management", level: 1 })).toBeVisible();
      await page.getByRole("button", { name: /Add Income/ }).click();
      await page.getByRole("heading", { name: "Salary", level: 4 }).click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Source Name *").fill("Gig");
      await page.getByLabel("Amount *").fill("100");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByLabel("Day of Month")).toHaveValue("10");
      await expect(page.locator("#startDate")).toHaveValue("03/10/2026");
    });
  }
});
