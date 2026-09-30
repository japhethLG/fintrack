/**
 * Weekend adjustment and occurrence identity, seen through the browser.
 * Every fixture starts in the future (no overdue items), currentBalance 1000, today = Tue 2026-03-10.
 *
 * March 2026: 1st = Sun, 15th = Sun, 30th = Mon.  July 2026: 1st = Wed, 31st = Fri; Aug 1 = Sat.
 */
import { test, expect, seedAndLogin, userProfile, incomeSource, knownDefect } from "../../index";
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
    await expect(summaryTile(page, "Income")).toHaveText("+$200");
    await expect(periodFigure(page, "Opening")).toHaveText("$1,000");
    await expect(periodFigure(page, "Closing")).toHaveText("$1,200");
    await expect(summaryTile(page, "Transactions")).toHaveText("0 / 2");
  });

  test("the two paydays keep distinct occurrence ids when completed (slot 1 and slot 2)", async ({ page }) => {
    knownDefect(
      "E2E-CAL-08",
      "Sunday 15th shifted to Mon 16th is numbered slot 2 (nearest-slot fallback), so both March paydays are stored with occurrenceId semi_2026-03-2"
    );
    await boot(page, semi());
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-16"), "Semi");
    await completeInDialog(page);
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-30"), "Semi");
    await completeInDialog(page);
    const byDate = Object.fromEntries((await storedTxns(page)).map((t) => [t.scheduledDate, t.occurrenceId]));
    expect(byDate).toEqual({ "2026-03-16": "semi_2026-03-1", "2026-03-30": "semi_2026-03-2" });
  });

  test("completing both paydays shows both completed (2 / 2) and keeps the opening balance", async ({ page }) => {
    knownDefect(
      "E2E-CAL-09",
      "second completion collides with the first: 3/16 vanishes, 3/30 shows a completed AND a projected copy, tile stays 1 / 2, March opening drifts to $1,100"
    );
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
    await expect(periodFigure(page, "Opening")).toHaveText("$1,000");
    await expect(periodFigure(page, "Closing")).toHaveText("$1,200");
  });

  test("dragging one payday moves only that payday", async ({ page }) => {
    knownDefect(
      "E2E-CAL-10",
      "both paydays share occurrence id semi_2026-03-2, so one override moves 3/16 AND 3/30 to the drop day"
    );
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
    await expect(periodFigure(page, "Opening")).toHaveText("$1,100");
    await expect(monthCell(page, "2026-07", "2026-07-01").getByText("First")).toBeVisible();
  };

  test("July shows Aug 1's payday on Fri 7/31 the first time it is visited", async ({ page }) => {
    knownDefect(
      "E2E-CAL-07",
      "weekend shift is applied AFTER the view-window filter: raw Aug 1 is outside Jul 1..Jul 31, so 7/31 is missing until August has been visited (closing 1,200 instead of 1,300)"
    );
    await boot(page, firstBefore());
    await toJuly(page);
    expect(await daysShowing(page, "2026-07", "First")).toEqual(["2026-07-01", "2026-07-31"]);
    await expect(periodFigure(page, "Closing")).toHaveText("$1,300"); // 1100 + Jul 1 + Jul 31
  });

  test("visiting August first makes 7/31 appear: July's closing figure depends on navigation history", async ({ page }) => {
    knownDefect(
      "E2E-CAL-07b",
      "same root cause seen as history dependence: July closing is 1,200 on first visit and 1,300 after visiting August (the range only grows)"
    );
    await boot(page, firstBefore());
    await toJuly(page);
    const first = await periodFigure(page, "Closing").innerText();
    await navigateToMonth(page, "2026-07", "2026-08");
    await navigateToMonth(page, "2026-08", "2026-07");
    await expect(monthCell(page, "2026-07", "2026-07-31").getByText("First")).toBeVisible(); // the part that works
    expect(await periodFigure(page, "Closing").innerText()).toBe(first);
  });

  test("completing the 7/31 payday completes THAT payday (7/1 stays projected) with August's identity", async ({ page }) => {
    knownDefect(
      "E2E-CAL-11",
      "7/31 (August's payday) gets July's id m1_2026-07, colliding with 7/1: completing it removes 7/1 from the calendar and leaves 7/31 twice"
    );
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

test.describe("daily, weekend 'after' (Sat 3/14 and Sun 3/15 both paid Mon 3/16)", () => {
  test("Monday carries three payments, the weekend is empty, totals add up", async ({ page }) => {
    await boot(page, dailyAfter());
    // 3/11,12,13 | 3/16 x3 | 3/17..3/20 | 3/23 x3 | 3/24..3/27 | 3/30 x3 | 3/31  = 21 payments of 10
    await expect(summaryTile(page, "Income")).toHaveText("+$210");
    await expect(summaryTile(page, "Transactions")).toHaveText("0 / 21");
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-14"))).toEqual([]);
    expect(await monthChipNames(monthCell(page, "2026-03", "2026-03-15"))).toEqual([]);
    await expect(monthCell(page, "2026-03", "2026-03-16")).toContainText("+1 more"); // 3 payments: 2 chips + "+1 more"
    await selectDay(monthCell(page, "2026-03", "2026-03-16"));
    await expect(page.getByText("Monday, Mar 16")).toBeVisible();
    expect(await sidebarCount(page)).toBe(3);
    // 3/11..3/13 = 30 already paid => opening 1030; +30 => closing 1060.
    await expect(page.locator("div.sticky")).toContainText("$1,030");
    await expect(page.locator("div.sticky")).toContainText("$1,060");
  });

  test("the day sidebar lists exactly as many rows as its header says", async ({ page }) => {
    knownDefect(
      "E2E-CAL-05",
      "three payments share the id proj_daily::2026-03-16::daily_2026-03-16; with duplicate React keys the sidebar shows stale extra rows (header says 3)"
    );
    await boot(page, dailyAfter());
    await selectDay(monthCell(page, "2026-03", "2026-03-16"));
    expect(await sidebarCount(page)).toBe(3);
    await expect(sidebarRows(page)).toHaveCount(3);
  });

  test("dragging one of the three Monday payments moves only that one", async ({ page }) => {
    knownDefect(
      "E2E-CAL-06",
      "all three payments share occurrence id daily_2026-03-16: one drag writes one override that moves all three to 3/19"
    );
    await boot(page, dailyAfter());
    await dragTo(page, monthCell(page, "2026-03", "2026-03-16").getByText("Daily").first(), monthCell(page, "2026-03", "2026-03-19"));
    await expect(monthCell(page, "2026-03", "2026-03-19")).toContainText("more"); // 1 native + moved ones => at least 2
    await selectDay(monthCell(page, "2026-03", "2026-03-19"));
    expect(await sidebarCount(page)).toBe(2); // native 3/19 + the one moved
    await selectDay(monthCell(page, "2026-03", "2026-03-16"));
    expect(await sidebarCount(page)).toBe(2); // the two that stayed
  });

  test("completing one of the three Monday payments leaves three items on Monday", async ({ page }) => {
    knownDefect(
      "E2E-CAL-12",
      "after completing one, Monday's cell draws 3 chips + '+1 more' (4 items) for 3 payments"
    );
    await boot(page, dailyAfter());
    await openTxnFromCell(page, monthCell(page, "2026-03", "2026-03-16"), "Daily");
    await completeInDialog(page);
    await expect(summaryTile(page, "Transactions")).toHaveText("1 / 21"); // works today
    expect((await monthChipNames(monthCell(page, "2026-03", "2026-03-16"))).length).toBe(2); // 3 items => 2 chips + "+1 more"
    await expect(monthCell(page, "2026-03", "2026-03-16")).toContainText("+1 more");
  });
});
