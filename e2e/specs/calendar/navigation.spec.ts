/**
 * Month / week navigation, year boundaries, month-end and month-start paydays, balance chaining.
 * Runs in UTC, Asia/Manila and America/New_York.
 *
 * Fixture: currentBalance 1000, today Tue 2026-03-10.
 *   First  +100 monthly on the 1st,  start 2026-01-01
 *   Last   +10  monthly on the 31st (clamped to the month's last day), start 2026-01-31
 * Hand values, decision D5 (docs/audit/fixes/display-numbers.md): nothing is completed, so the realized
 * balance is 1000. The paydays before today (Jan 1, Jan 31, Feb 1, Feb 28, Mar 1) are OVERDUE: they are
 * listed (the month's Income tile still counts them, +110) but move nothing, and an overdue income is not
 * credited. From today (Mar 10) on each month adds 110 (the 1st +100, the last day +10).
 *   Jan 1000 -> 1000 | Feb 1000 -> 1000 | Mar 1000 -> 1010 (only Mar 31's +10 is upcoming)
 *   Apr 1010 -> 1120 | May 1120 -> 1230 | Jun 1230 -> 1340 | Jul 1340 -> 1450 | Aug 1450 -> 1560
 */
import { test, expect, seedAndLogin, userProfile, incomeSource } from "../../index";
import {
  addDaysISO,
  daysShowing,
  monthCell,
  monthHeading,
  navigateToMonth,
  nextButton,
  periodFigure,
  prevButton,
  sidebar,
  summaryTile,
  viewedHeading,
  weekCell,
  weekChipNames,
} from "./_support";

test.use({ viewport: { width: 1440, height: 1500 } });

const boot = async (page: import("@playwright/test").Page) => {
  await seedAndLogin(
    page,
    {
      user: userProfile({ currentBalance: 1000, initialBalance: 1000 }),
      incomeSources: [
        incomeSource({ id: "first", name: "First", amount: 100, frequency: "monthly", scheduleConfig: { dayOfMonth: 1 }, startDate: "2026-01-01" }),
        incomeSource({ id: "last", name: "Last", amount: 10, frequency: "monthly", scheduleConfig: { dayOfMonth: 31 }, startDate: "2026-01-31" }),
      ],
    },
    { path: "/calendar" }
  );
  await expect(viewedHeading(page)).toHaveText("March 2026");
};

const FIGURES: Record<string, [string, string]> = {
  "2026-01": ["$1,000", "$1,000"],
  "2026-02": ["$1,000", "$1,000"],
  "2026-03": ["$1,000", "$1,010"],
  "2026-04": ["$1,010", "$1,120"],
  "2026-05": ["$1,120", "$1,230"],
  "2026-06": ["$1,230", "$1,340"],
  "2026-07": ["$1,340", "$1,450"],
  "2026-08": ["$1,450", "$1,560"],
};

test("March: the 1st (a Sunday) and the 31st are both drawn, in every timezone", async ({ page }) => {
  await boot(page);
  expect(await daysShowing(page, "2026-03", "First")).toEqual(["2026-03-01"]);
  expect(await daysShowing(page, "2026-03", "Last")).toEqual(["2026-03-31"]);
  await expect(periodFigure(page, "Opening")).toHaveText("$1,000");
  await expect(periodFigure(page, "Closing")).toHaveText("$1,010");
});

test("walking back from March to January and forward to May: paydays on the 1st are never dropped and balances chain", async ({ page }) => {
  await boot(page);
  let prev = "2026-03";
  for (const m of ["2026-02", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]) {
    await navigateToMonth(page, prev, m);
    prev = m;
    expect(await daysShowing(page, m, "First"), `First in ${m}`).toEqual([`${m}-01`]);
    await expect(periodFigure(page, "Opening"), `${m} opening`).toHaveText(FIGURES[m][0]);
    await expect(periodFigure(page, "Closing"), `${m} closing`).toHaveText(FIGURES[m][1]);
    await expect(summaryTile(page, "Income"), `${m} income`).toHaveText("+$110");
  }
});

test("month-start paydays keep appearing on months beyond the initial window (Jun..Aug), in every timezone", async ({ page }) => {
  await boot(page);
  let prev = "2026-03";
  for (const m of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]) {
    await navigateToMonth(page, prev, m);
    prev = m;
    expect(await daysShowing(page, m, "First"), `First in ${m}`).toEqual([`${m}-01`]);
    await expect(periodFigure(page, "Opening"), `${m} opening`).toHaveText(FIGURES[m][0]);
  }
});

test("the last day of every month is drawn and closing balances chain (Jun..Aug)", async ({ page }, testInfo) => {
  await boot(page);
  let prev = "2026-03";
  const lastDays: Record<string, string> = { "2026-06": "2026-06-30", "2026-07": "2026-07-31", "2026-08": "2026-08-31" };
  await navigateToMonth(page, prev, "2026-06");
  prev = "2026-06";
  for (const m of ["2026-06", "2026-07", "2026-08"]) {
    if (m !== prev) {
      await navigateToMonth(page, prev, m);
      prev = m;
    }
    expect(await daysShowing(page, m, "Last"), `Last in ${m}`).toEqual([lastDays[m]]);
    await expect(periodFigure(page, "Closing"), `${m} closing`).toHaveText(FIGURES[m][1]);
  }
});

test("year boundary: December 2026 -> January 2027 -> back, headings, weekday alignment and chained balances", async ({ page }) => {
  await boot(page);
  await navigateToMonth(page, "2026-03", "2026-12");
  await expect(periodFigure(page, "Opening")).toHaveText("$1,890"); // Mar closes 1010; +110 per month for Apr..Nov = 8 * 110 = 880 => 1890
  await nextButton(page).click();
  await expect(viewedHeading(page)).toHaveText("January 2027");
  // Jan 1 2027 is a Friday: 5 leading cells (Dec 27..31) then the 1st is the 6th cell.
  expect(await daysShowing(page, "2027-01", "First")).toEqual(["2027-01-01"]);
  await expect(monthCell(page, "2027-01", "2027-01-01")).toContainText("1");
  // Dec closing == Jan opening: Dec opens 1890, closes 2000.
  await expect(periodFigure(page, "Opening")).toHaveText("$2,000");
  await prevButton(page).click();
  await expect(viewedHeading(page)).toHaveText("December 2026");
  await expect(periodFigure(page, "Closing")).toHaveText("$2,000");
});

test("week view: previous/next cross a month boundary, Today returns to the current week and selects today", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(viewedHeading(page)).toHaveText("Mar 8 - Mar 14, 2026");
  await nextButton(page).click();
  await nextButton(page).click();
  await nextButton(page).click(); // Mar 29 .. Apr 4
  await expect(viewedHeading(page)).toHaveText("Mar 29 - Apr 4, 2026");
  expect(await weekChipNames(weekCell(page, "2026-03-31"))).toEqual(["Last"]);
  expect(await weekChipNames(weekCell(page, "2026-04-01"))).toEqual(["First"]);
  // Mar 29 opening = the realized 1000 (the past paydays are overdue and not credited, D5);
  // + Mar 31 (10) + Apr 1 (100) = 1110.
  await expect(periodFigure(page, "Opening")).toHaveText("$1,000");
  await expect(periodFigure(page, "Closing")).toHaveText("$1,110");
  await prevButton(page).click();
  await prevButton(page).click();
  await prevButton(page).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(viewedHeading(page)).toHaveText("Mar 8 - Mar 14, 2026");
  await expect(sidebar(page)).toContainText("Tuesday, Mar 10");
});

test("month heading and the 42-cell grid are consistent for every month of 2026", async ({ page }) => {
  await boot(page);
  await navigateToMonth(page, "2026-03", "2026-01");
  for (let m = 1; m <= 12; m++) {
    const key = `2026-${String(m).padStart(2, "0")}`;
    await expect(viewedHeading(page)).toHaveText(monthHeading(key));
    // The cell for the 1st exists at its weekday offset and shows the number "1" as its first token.
    const cellText = await monthCell(page, key, `${key}-01`).innerText();
    expect(cellText.trim().split(/\s+/)[0]).toBe("1");
    const lastDay = addDaysISO(`${m === 12 ? 2027 : 2026}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`, -1);
    const lastText = await monthCell(page, key, lastDay).innerText();
    expect(lastText.trim().split(/\s+/)[0]).toBe(String(Number(lastDay.slice(8))));
    if (m < 12) await nextButton(page).click();
  }
});
