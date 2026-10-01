/**
 * Weekend adjustment and occurrence identity, seen through the browser.
 * Every fixture starts in the future (no overdue items), currentBalance 1000, today = Tue 2026-03-10.
 *
 * March 2026: 1st = Sun, 15th = Sun, 30th = Mon.  July 2026: 1st = Wed, 31st = Fri; Aug 1 = Sat.
 */
import { test, expect, seedAndLogin, userProfile, incomeSource } from "../../index";
import {
  completeInDialog,
  daysShowing,
  dragTo,
  monthCell,
  monthChipNames,
  navigateToMonth,
  openTxnFromCell,
  periodFigure,
  selectDay,
  sidebarCount,
  sidebarRows,
  storedTxns,
  summaryTile,
  viewedHeading,
} from "./_support";

test.use({ viewport: { width: 1440, height: 1500 } });

const boot = async (page: import("@playwright/test").Page, src: ReturnType<typeof incomeSource>) => {
  await seedAndLogin(page, { user: userProfile({ currentBalance: 1000, initialBalance: 1000 }), incomeSources: [src] }, { path: "/calendar" });
  await expect(viewedHeading(page)).toHaveText("March 2026");
};

const semi = () =>
  incomeSource({
    id: "semi",
    name: "Semi",
    amount: 100,
    frequency: "semi-monthly",
    scheduleConfig: { specificDays: [15, 30] },
    weekendAdjustment: "after",
    startDate: "2026-03-11",
  });
const firstBefore = () =>
  incomeSource({
    id: "m1",
    name: "First",
    amount: 100,
    frequency: "monthly",
    scheduleConfig: { dayOfMonth: 1 },
    weekendAdjustment: "before",
    startDate: "2026-06-01",
  });
const dailyAfter = () =>
  incomeSource({ id: "daily", name: "Daily", amount: 10, frequency: "daily", scheduleConfig: {}, weekendAdjustment: "after", startDate: "2026-03-11" });

test.describe("semi-monthly [15,30], weekend 'after' (Sun 3/15 -> Mon 3/16, Mon 3/30 stays)", () => {
  test("both paydays are drawn once, on the adjusted dates, and counted once each", async ({ page }) => {
    await boot(page, semi());
    expect(await daysShowing(page, "2026-03", "Semi")).toEqual(["2026-03-16", "2026-03-30"]);
    await expect(summaryTile(page, "Income")).toHaveText("+$200.00");
    await expect(periodFigure(page, "Opening")).toHaveText("$1,000.00");
    await expect(periodFigure(page, "Closing")).toHaveText("$1,200.00");
    await expect(summaryTile(page, "Transactions")).toHaveText("0 / 2");
  });

  test("the two paydays keep distinct occurrence ids when completed (slot 1 and slot 2)", async ({ page }) => {
    await boot(page, semi());
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-16"), "Semi");
    await completeInDialog(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-30"), "Semi");
    await completeInDialog(page);
    const byDate = Object.fromEntries((await storedTxns(page)).map((t) => [t.scheduledDate, t.occurrenceId]));
    expect(byDate).toEqual({ "2026-03-16": "semi_2026-03-1", "2026-03-30": "semi_2026-03-2" });
  });

  test("completing both paydays shows both completed (2 / 2) and keeps the opening balance", async ({ page }) => {
    await boot(page, semi());
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-16"), "Semi");
    await completeInDialog(page);
    // Precondition (works today): one completed, one projected.
    await expect(summaryTile(page, "Transactions")).toHaveText("1 / 2");
    expect(await daysShowing(page, "2026-03", "Semi")).toEqual(["2026-03-16", "2026-03-30"]);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-30"), "Semi");
    await completeInDialog(page);
    // Balance is 1000 + 100 + 100 in Firestore (this part is right) ...
    expect((await storedTxns(page)).length).toBe(2);
    // ... and the calendar must agree: each payday once, both completed, opening unchanged.
    expect(await daysShowing(page, "2026-03", "Semi")).toEqual(["2026-03-16", "2026-03-30"]);
    await expect(summaryTile(page, "Transactions")).toHaveText("2 / 2");
    await expect(periodFigure(page, "Opening")).toHaveText("$1,000.00");
    await expect(periodFigure(page, "Closing")).toHaveText("$1,200.00");
  });

  test("dragging one payday moves only that payday", async ({ page }) => {
    await boot(page, semi());
    await dragTo(page, monthCell(page, "2026-03", "2026-03-16").getByText("Semi"), monthCell(page, "2026-03", "2026-03-18"));
    await expect(monthCell(page, "2026-03", "2026-03-18").getByText("Semi").first()).toBeVisible();
    expect(await daysShowing(page, "2026-03", "Semi")).toEqual(["2026-03-18", "2026-03-30"]);
  });
});

test.describe("monthly on the 1st, weekend 'before' (Sat Aug 1 is paid Fri Jul 31)", () => {
  const toJuly = async (page: import("@playwright/test").Page) => {
    await navigateToMonth(page, "2026-03", "2026-07");
    // Hand values: Jun 1 (+100) happened before July => July opens at 1000 + 100.
    await expect(periodFigure(page, "Opening")).toHaveText("$1,100.00");
    await expect(monthCell(page, "2026-07", "2026-07-01").getByText("First")).toBeVisible();
  };

  test("July shows Aug 1's payday on Fri 7/31 the first time it is visited", async ({ page }) => {
    await boot(page, firstBefore());
    await toJuly(page);
    expect(await daysShowing(page, "2026-07", "First")).toEqual(["2026-07-01", "2026-07-31"]);
    await expect(periodFigure(page, "Closing")).toHaveText("$1,300.00"); // 1100 + Jul 1 + Jul 31
  });

  test("visiting August first makes 7/31 appear: July's closing figure depends on navigation history", async ({ page }) => {
    await boot(page, firstBefore());
    await toJuly(page);
    const first = await periodFigure(page, "Closing").innerText();
    await navigateToMonth(page, "2026-07", "2026-08");
    await navigateToMonth(page, "2026-08", "2026-07");
    await expect(monthCell(page, "2026-07", "2026-07-31").getByText("First")).toBeVisible(); // the part that works
    expect(await periodFigure(page, "Closing").innerText()).toBe(first);
  });

  test("completing the 7/31 payday completes THAT payday (7/1 stays projected) with August's identity", async ({ page }) => {
    await boot(page, firstBefore());
    await toJuly(page);
    await navigateToMonth(page, "2026-07", "2026-08");
    await navigateToMonth(page, "2026-08", "2026-07");
    await expect(monthCell(page, "2026-07", "2026-07-31").getByText("First")).toBeVisible();
    await openTxnFromCell(page, monthCell(page, "2026-07", "2026-07-31"), "First");
    await completeInDialog(page);
    const [done] = await storedTxns(page);
    expect(done.occurrenceId).toBe("m1_2026-08");
    expect(await daysShowing(page, "2026-07", "First")).toEqual(["2026-07-01", "2026-07-31"]);
    await expect(summaryTile(page, "Transactions")).toHaveText("1 / 2");
  });
});

// DECISION (docs/audit/fixes/engine-dates.md): a daily rule has an occurrence EVERY day, so weekend adjustment does not
// apply to it. The old behaviour stacked Sat + Sun + Mon on one Monday under ONE occurrence id (E2E-CAL-05/06/12).
test.describe("daily, weekend 'after' (daily rules ignore the weekend setting: every day keeps its own payment)", () => {
  test("every day carries exactly one payment, weekend included, and totals add up", async ({ page }) => {
    await boot(page, dailyAfter());
    // 3/11 .. 3/31 = 21 days = 21 payments of 10, one per day (weekend days included)
    await expect(summaryTile(page, "Income")).toHaveText("+$210.00");
    await expect(summaryTile(page, "Transactions")).toHaveText("0 / 21");
    for (const day of ["2026-03-14", "2026-03-15", "2026-03-16"]) {
      expect(await monthChipNames(monthCell(page, "2026-03", day)), day).toEqual(["Daily"]);
    }
    await selectDay(monthCell(page, "2026-03", "2026-03-16"));
    await expect(page.getByText("Monday, Mar 16")).toBeVisible();
    expect(await sidebarCount(page)).toBe(1);
    // 3/11..3/15 = 5 payments of 10 => Monday opens at 1050 and closes at 1060.
    await expect(page.locator("div.sticky")).toContainText("$1,050");
    await expect(page.locator("div.sticky")).toContainText("$1,060");
  });

  test("the day sidebar lists exactly as many rows as its header says", async ({ page }) => {
    await boot(page, dailyAfter());
    await selectDay(monthCell(page, "2026-03", "2026-03-14")); // a Saturday
    expect(await sidebarCount(page)).toBe(1);
    await expect(sidebarRows(page)).toHaveCount(1);
  });

  test("dragging one day's payment moves only that one", async ({ page }) => {
    await boot(page, dailyAfter());
    await dragTo(page, monthCell(page, "2026-03", "2026-03-14").getByText("Daily").first(), monthCell(page, "2026-03", "2026-03-19"));
    // 3/19 now holds its own payment plus the moved one; 3/14 is empty; 3/15 and 3/16 are untouched.
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-19"))).toEqual(["Daily", "Daily"]);
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-14"))).toEqual([]);
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-15"))).toEqual(["Daily"]);
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-16"))).toEqual(["Daily"]);
  });

  test("completing one day's payment leaves one item on that day, stored under that day's own id", async ({ page }) => {
    await boot(page, dailyAfter());
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-16"), "Daily");
    await completeInDialog(page);
    await expect(summaryTile(page, "Transactions")).toHaveText("1 / 21");
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-16"))).toEqual(["Daily"]);
    await expect(monthCell(page, "2026-03", "2026-03-16")).not.toContainText("more");
    const [done] = await storedTxns(page);
    expect(done.occurrenceId).toBe("daily_2026-03-16");
  });
});
